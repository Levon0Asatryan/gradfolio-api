import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AppConfig } from '../config/schema.js';
import type { Database } from '../db/database.js';
import { inTransaction } from '../db/transaction.js';
import { MailDeliveryError, type Mailer } from './mailer.js';
import { inviteEmail } from './templates.js';
import { unsubscribeToken } from './unsubscribe.js';

export class EmailWorker {
  constructor(
    private readonly db: Database,
    private readonly cfg: AppConfig,
    private readonly mailer: Mailer,
  ) {}

  async runBatch(): Promise<{ processed: number; disabled: boolean }> {
    await this.db
      .deleteFrom('emailOutbox')
      .where(
        'createdAt',
        '<',
        sql<Date>`DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ${this.cfg.EMAIL_RETENTION_DAYS} DAY)`,
      )
      .where((eb) =>
        eb.or([
          eb('status', 'not in', ['leased', 'dispatching']),
          eb('leaseExpiresAt', '<=', sql<Date>`UTC_TIMESTAMP(3)`),
        ]),
      )
      .execute();
    if (!this.cfg.EMAIL_DELIVERY_ENABLED) return { processed: 0, disabled: true };
    if (!this.cfg.EMAIL_UNSUBSCRIBE_SECRET || !this.cfg.EMAIL_PUBLIC_URL)
      throw new Error('email settings missing');
    let processed = 0;
    for (; processed < this.cfg.EMAIL_BATCH_SIZE; processed++) {
      const row = await this.claim();
      if (!row) break;
      let dispatchStarted = row.status === 'dispatching';
      const settle = async (
        status: 'sent' | 'failed' | 'pending' | 'uncertain' | 'canceled',
        fields: { providerMessageId?: string; failureCode?: string } = {},
      ) => {
        await this.db
          .updateTable('emailOutbox')
          .set({
            status,
            ...fields,
            leaseToken: null,
            leaseExpiresAt: null,
            ...(status === 'sent' ? { sentAt: sql<Date>`UTC_TIMESTAMP(3)` } : {}),
            ...(status === 'pending'
              ? {
                  nextAttemptAt: sql<Date>`DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${Math.min(this.cfg.EMAIL_RETRY_MAX_S, this.cfg.EMAIL_RETRY_BASE_S * 2 ** Math.min(row.attempts, 20)) + Math.floor(Math.random() * this.cfg.EMAIL_RETRY_BASE_S)} SECOND)`,
                }
              : {}),
          })
          .where('id', '=', row.id)
          .where('status', '=', dispatchStarted ? 'dispatching' : 'leased')
          .where('leaseToken', '=', row.leaseToken)
          .execute();
      };
      // A stale claim may have reached the provider. Only a still-valid idempotency promise makes retry safe.
      if (
        (row.status === 'dispatching' ||
          (row.attempts > 0 && this.mailer.idempotencyWindowMs > 0)) &&
        (!row.firstAttemptAt ||
          Date.now() - row.firstAttemptAt.getTime() >= this.mailer.idempotencyWindowMs)
      ) {
        await settle('uncertain', { failureCode: 'LEASE_EXPIRED' });
        continue;
      }
      if (row.attempts >= this.cfg.EMAIL_MAX_ATTEMPTS) {
        await settle(row.status === 'dispatching' ? 'uncertain' : 'failed', {
          failureCode: 'ATTEMPTS_EXHAUSTED',
        });
        continue;
      }
      if (Date.now() - row.createdAt.getTime() > this.cfg.EMAIL_INVITE_MAX_AGE_S * 1000) {
        await settle(dispatchStarted ? 'uncertain' : 'canceled', { failureCode: 'EXPIRED' });
        continue;
      }
      const recipient = await this.db
        .selectFrom('users')
        .select(['email', 'emailVerified', 'emailSuppressed', 'teamInviteEmailEnabled'])
        .where('id', '=', row.recipientUserId)
        .executeTakeFirst();
      const pending = await this.db
        .selectFrom('projectTeamMembers')
        .select('id')
        .where('projectId', '=', row.projectId)
        .where('userId', '=', row.recipientUserId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (
        !recipient?.email ||
        !recipient.emailVerified ||
        recipient.emailSuppressed ||
        !recipient.teamInviteEmailEnabled ||
        !pending
      ) {
        await settle(dispatchStarted ? 'uncertain' : 'canceled', { failureCode: 'INELIGIBLE' });
        continue;
      }
      const destinationHash = createHash('sha256').update(recipient.email).digest('hex');
      if (row.destinationHash && row.destinationHash !== destinationHash) {
        await settle('uncertain', { failureCode: 'DESTINATION_CHANGED' });
        continue;
      }
      // Dispatch is the cancellation boundary: either cancellation wins this CAS,
      // or it must leave the lease intact so the provider outcome can be recorded.
      const claimed = await this.db
        .updateTable('emailOutbox')
        .set({ destinationHash, status: 'dispatching' })
        .where('id', '=', row.id)
        .where('leaseToken', '=', row.leaseToken)
        .where('status', '=', dispatchStarted ? 'dispatching' : 'leased')
        .executeTakeFirst();
      if (Number(claimed.numUpdatedRows) === 0) continue;
      dispatchStarted = true;
      try {
        const content = inviteEmail(
          row.language,
          row.actorName,
          row.projectTitle,
          this.cfg.EMAIL_PUBLIC_URL,
          unsubscribeToken(
            row.recipientUserId,
            this.cfg.EMAIL_UNSUBSCRIBE_SECRET,
            row.createdAt.getTime() + this.cfg.EMAIL_UNSUBSCRIBE_TTL_S * 1000,
          ),
        );
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result: { messageId: string };
        try {
          result = await Promise.race([
            this.mailer.send(
              { to: recipient.email, ...content, idempotencyKey: row.id },
              controller.signal,
            ),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(new Error('unknown delivery outcome'));
              }, this.cfg.EMAIL_SEND_TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        const { messageId } = result;
        await settle('sent', { providerMessageId: messageId });
      } catch (error) {
        const temporary = error instanceof MailDeliveryError && error.kind === 'temporary';
        const status = temporary
          ? row.attempts + 1 >= this.cfg.EMAIL_MAX_ATTEMPTS
            ? 'failed'
            : 'pending'
          : error instanceof MailDeliveryError
            ? 'failed'
            : 'uncertain';
        await settle(status, {
          failureCode: temporary
            ? 'TEMPORARY'
            : error instanceof MailDeliveryError
              ? 'PERMANENT'
              : 'UNKNOWN_OUTCOME',
        });
      }
    }
    return { processed, disabled: false };
  }

  private claim() {
    return inTransaction(this.db, async (trx) => {
      const row = await trx
        .selectFrom('emailOutbox')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb.and([
              eb('status', '=', 'pending'),
              eb('nextAttemptAt', '<=', sql<Date>`UTC_TIMESTAMP(3)`),
            ]),
            eb.and([
              eb('status', 'in', ['leased', 'dispatching']),
              eb('leaseExpiresAt', '<=', sql<Date>`UTC_TIMESTAMP(3)`),
            ]),
          ]),
        )
        .orderBy('nextAttemptAt')
        .orderBy('id')
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!row) return undefined;
      const leaseToken = randomUUID();
      await trx
        .updateTable('emailOutbox')
        .set({
          status: row.status === 'dispatching' ? 'dispatching' : 'leased',
          leaseToken,
          leaseExpiresAt: sql<Date>`DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${this.cfg.EMAIL_LEASE_S} SECOND)`,
          firstAttemptAt: row.firstAttemptAt ?? sql<Date>`UTC_TIMESTAMP(3)`,
          attempts: sql<number>`attempts + 1`,
        })
        .where('id', '=', row.id)
        .execute();
      return { ...row, leaseToken };
    });
  }

  /** Only a verified provider webhook adapter may call this; no unsigned HTTP endpoint exists. */
  async recordFeedback(
    id: string,
    messageId: string,
    status: 'bounced' | 'complained',
  ): Promise<void> {
    await inTransaction(this.db, async (trx) => {
      const row = await trx
        .selectFrom('emailOutbox')
        .select(['recipientUserId', 'providerMessageId', 'destinationHash'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row || (row.providerMessageId !== null && row.providerMessageId !== messageId)) return;
      await trx
        .updateTable('emailOutbox')
        .set({ status, providerMessageId: messageId, leaseToken: null, leaseExpiresAt: null })
        .where('id', '=', id)
        .execute();
      const recipient = await trx
        .selectFrom('users')
        .select('email')
        .where('id', '=', row.recipientUserId)
        .executeTakeFirst();
      if (
        recipient?.email &&
        createHash('sha256').update(recipient.email).digest('hex') === row.destinationHash
      ) {
        await trx
          .updateTable('users')
          .set({ emailSuppressed: true })
          .where('id', '=', row.recipientUserId)
          .where('email', '=', recipient.email)
          .execute();
      }
    });
  }
}
