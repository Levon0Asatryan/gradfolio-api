import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { sql } from 'kysely';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, captureLogs } from '../../../testing/app.js';
import { testConfig, testDatabase } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { enqueueInviteEmail } from '../../../core/email/outbox.js';
import { EmailWorker } from '../../../core/email/worker.js';
import { MailDeliveryError, type EmailMessage, type Mailer } from '../../../core/email/mailer.js';
import { unsubscribeToken } from '../../../core/email/unsubscribe.js';

const db = testDatabase();
const sendgridKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const sendgridPublicKey = sendgridKeys.publicKey
  .export({ format: 'der', type: 'spki' })
  .toString('base64');
const secret = 'email-test-secret-'.repeat(3);
const webhookSecret =
  'whsec_' + Buffer.from('webhook-test-secret-material-32bytes').toString('base64');
const cfg = testConfig({
  EMAIL_DELIVERY_ENABLED: 'true',
  EMAIL_PUBLIC_URL: 'https://app.example',
  EMAIL_UNSUBSCRIBE_SECRET: secret,
});
let app: NestExpressApplication;
let tenant: TestTenant;
const logs = captureLogs();
beforeAll(async () => {
  tenant = await startTestTenant();
  app = await buildApp(
    testConfig({
      LOG_LEVEL: 'warn',
      AUTH0_ISSUER_BASE_URL: tenant.issuer,
      AUTH0_AUDIENCE: tenant.audience,
      EMAIL_UNSUBSCRIBE_SECRET: secret,
      RESEND_WEBHOOK_SECRET: webhookSecret,
      SENDGRID_WEBHOOK_PUBLIC_KEY: sendgridPublicKey,
      RATE_LIMIT_EMAIL: '100',
    }),
    undefined,
    { logs },
  );
});
afterAll(async () => {
  await app.close();
  await tenant.close();
});
beforeEach(async () => {
  await db.deleteFrom('users').execute();
  logs.clear();
});

class FakeMailer implements Mailer {
  readonly idempotencyWindowMs = 86400_000;
  readonly accepted = new Map<string, EmailMessage>();
  send(message: EmailMessage): Promise<{ messageId: string }> {
    const old = this.accepted.get(message.idempotencyKey);
    if (old) expect(message).toEqual(old);
    this.accepted.set(message.idempotencyKey, message);
    return Promise.resolve({ messageId: `provider-${message.idempotencyKey}` });
  }
}

async function people() {
  const owner = await createUser(db, { auth0Id: `auth0|owner-${randomUUID()}` });
  const invitee = await createUser(db, {
    auth0Id: `auth0|invitee-${randomUUID()}`,
    email: 'private-inbox@example.com',
    emailVerified: true,
    preferredLanguage: 'am',
  });
  const { project } = await createProject(db, owner, { title: 'Թիմային նախագիծ' });
  const auth = { Authorization: `Bearer ${await tenant.sign({ sub: owner.auth0Id })}` };
  const invite = () =>
    request(app.getHttpServer())
      .post(`/v1/projects/${project.id}/team`)
      .set(auth)
      .send({ userId: invitee.id, role: 'Developer' });
  return { owner, invitee, project, invite };
}

const rows = () => db.selectFrom('emailOutbox').selectAll().orderBy('createdAt').execute();

describe('signed SendGrid feedback over HTTP', () => {
  const post = (body: string, timestamp = String(Math.floor(Date.now() / 1000)), valid = true) => {
    const signature = sign(
      'sha256',
      Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]),
      sendgridKeys.privateKey,
    ).toString('base64');
    return request(app.getHttpServer())
      .post('/v1/email/webhooks/sendgrid')
      .set('content-type', 'application/json')
      .set('x-twilio-email-event-webhook-timestamp', timestamp)
      .set('x-twilio-email-event-webhook-signature', valid ? signature : 'invalid')
      .send(body);
  };
  it.each(['bounce', 'spamreport'])(
    'records %s with provider suffix correlation and harmless replay',
    async (event) => {
      const { invite, invitee } = await people();
      await invite().expect(201);
      await new EmailWorker(db, cfg, {
        idempotencyWindowMs: 0,
        send: () => Promise.resolve({ messageId: 'sg-request' }),
      }).runBatch();
      const [row] = await rows();
      const body = JSON.stringify(
        [
          {
            event,
            outbox_id: row!.id,
            sg_message_id: 'sg-request.filter-0.0',
            email: 'private-inbox@example.com',
            subject: 'Թիմ',
          },
        ],
        null,
        2,
      );
      await post(body).expect(200);
      await post(body).expect(200);
      expect((await rows())[0]).toMatchObject({
        status: event === 'bounce' ? 'bounced' : 'complained',
        providerMessageId: 'sg-request',
      });
      expect(
        (
          await db
            .selectFrom('users')
            .select('emailSuppressed')
            .where('id', '=', invitee.id)
            .executeTakeFirstOrThrow()
        ).emailSuppressed,
      ).toBe(true);
      expect(logs.text()).not.toContain('private-inbox@example.com');
    },
  );
  it('rejects invalid signatures and correlation before mutating any row; ignores wrong message IDs', async () => {
    const { invite } = await people();
    await invite().expect(201);
    const [row] = await rows();
    const body = JSON.stringify([
      { event: 'bounce', outbox_id: row!.id, sg_message_id: 'sg-request.filter' },
    ]);
    await post(body, undefined, false).expect(400);
    await post(body, String(Math.floor(Date.now() / 1000) - 301)).expect(400);
    await request(app.getHttpServer()).post('/v1/email/webhooks/sendgrid').send([]).expect(400);
    await post('[{"event":"bounce"}]').expect(200);
    await post(JSON.stringify([{ event: 'bounce', outbox_id: row!.id }])).expect(400);
    await post('{}').expect(400);
    await post('[{"event":"delivered"}]').expect(200);
    expect((await rows())[0]!.status).toBe('pending');
    await new EmailWorker(db, cfg, {
      idempotencyWindowMs: 0,
      send: () => Promise.resolve({ messageId: 'other-request' }),
    }).runBatch();
    await post(body).expect(200);
    expect((await rows())[0]!.status).toBe('sent');
  });
  it('quarantines expired dispatches without a SendGrid deduplication guarantee', async () => {
    const { invite } = await people();
    await invite().expect(201);
    await db
      .updateTable('emailOutbox')
      .set({
        status: 'dispatching',
        leaseExpiresAt: new Date(0),
        attempts: 1,
        firstAttemptAt: new Date(),
      })
      .execute();
    let sends = 0;
    await new EmailWorker(db, cfg, {
      idempotencyWindowMs: 0,
      send: () => {
        sends++;
        return Promise.resolve({ messageId: 'duplicate' });
      },
    }).runBatch();
    expect(sends).toBe(0);
    expect((await rows())[0]!.status).toBe('uncertain');
  });
});

describe('signed Resend feedback over HTTP', () => {
  const post = (body: string, timestamp = String(Math.floor(Date.now() / 1000)), valid = true) => {
    const id = 'msg_test';
    const signature = createHmac('sha256', Buffer.from(webhookSecret.slice(6), 'base64'))
      .update(`${id}.${timestamp}.${body}`)
      .digest('base64');
    return request(app.getHttpServer())
      .post('/v1/email/webhooks/resend')
      .set('Content-Type', 'application/json')
      .set('svix-id', id)
      .set('svix-timestamp', timestamp)
      .set('svix-signature', valid ? `v1,${signature}` : 'v1,invalid')
      .send(body);
  };

  it.each(['email.bounced', 'email.complained'] as const)(
    'records %s and suppresses later sends; replay is harmless',
    async (type) => {
      const { invite, invitee } = await people();
      await invite().expect(201);
      const [row] = await rows();
      const messageId = randomUUID();
      await new EmailWorker(db, cfg, {
        idempotencyWindowMs: 86400_000,
        send: () => Promise.resolve({ messageId }),
      }).runBatch();
      // Spaces and Unicode prove verification uses the raw bytes, not stringify(parsedJSON).
      const body = JSON.stringify(
        {
          type,
          data: {
            email_id: messageId,
            tags: { outbox_id: row!.id },
            subject: 'Թիմ',
            to: ['private-inbox@example.com'],
          },
        },
        null,
        2,
      );
      await post(body).expect(200, { received: true });
      await post(body).expect(200, { received: true });
      expect((await rows())[0]!.status).toBe(type === 'email.bounced' ? 'bounced' : 'complained');
      expect(
        (
          await db
            .selectFrom('users')
            .select('emailSuppressed')
            .where('id', '=', invitee.id)
            .executeTakeFirstOrThrow()
        ).emailSuppressed,
      ).toBe(true);
      expect(logs.text()).not.toContain('private-inbox@example.com');
      expect(logs.text()).not.toContain(webhookSecret);
    },
  );

  it('rejects unsigned/tampered/stale events without suppressing a recipient', async () => {
    const { invite, invitee } = await people();
    await invite().expect(201);
    const [row] = await rows();
    const body = JSON.stringify({
      type: 'email.bounced',
      data: { email_id: randomUUID(), tags: { outbox_id: row!.id } },
    });
    await post(body, undefined, false).expect(400);
    await post(body, String(Math.floor(Date.now() / 1000) - 301)).expect(400);
    await request(app.getHttpServer())
      .post('/v1/email/webhooks/resend')
      .send(JSON.parse(body) as object)
      .expect(400);
    expect((await rows())[0]!.status).toBe('pending');
    expect(
      (
        await db
          .selectFrom('users')
          .select('emailSuppressed')
          .where('id', '=', invitee.id)
          .executeTakeFirstOrThrow()
      ).emailSuppressed,
    ).toBe(false);
  });

  it('ignores other signed events; refuses missing correlation and ignores wrong message IDs', async () => {
    await post('{"type":"email.delivered","data":{}}').expect(200);
    await post('{"type":"email.bounced","data":{}}').expect(400);
    await post('{"data":{}}').expect(400);
    const { invite } = await people();
    await invite().expect(201);
    const messageId = randomUUID();
    await new EmailWorker(db, cfg, {
      idempotencyWindowMs: 86400_000,
      send: () => Promise.resolve({ messageId }),
    }).runBatch();
    const [row] = await rows();
    await post(
      JSON.stringify({
        type: 'email.bounced',
        data: { email_id: randomUUID(), tags: { outbox_id: row!.id } },
      }),
    ).expect(200);
    expect((await rows())[0]!.status).toBe('sent');
  });

  it('does not retry a known rejection beyond the provider deduplication window', async () => {
    const { invite } = await people();
    await invite().expect(201);
    await db
      .updateTable('emailOutbox')
      .set({ attempts: 1, firstAttemptAt: sql<Date>`DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR)` })
      .execute();
    let sends = 0;
    await new EmailWorker(db, cfg, {
      idempotencyWindowMs: 1000,
      send: () => {
        sends++;
        return Promise.resolve({ messageId: randomUUID() });
      },
    }).runBatch();
    expect(sends).toBe(0);
    expect((await rows())[0]!.status).toBe('uncertain');
  });
});

describe('email preferences and invitation outbox', () => {
  it.each(['reject', 'remove'] as const)(
    'records an in-flight delivery when the invitation is %s',
    async (action) => {
      const { invite, project, invitee, owner } = await people();
      await invite().expect(201);
      let entered!: () => void;
      let finish!: () => void;
      const sending = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const release = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const worker = new EmailWorker(db, cfg, {
        idempotencyWindowMs: 86400_000,
        async send() {
          entered();
          await release;
          return { messageId: 'delivered-after-answer' };
        },
      });
      const run = worker.runBatch();
      await sending;
      try {
        expect((await rows())[0]?.status).toBe('dispatching');
        if (action === 'reject') {
          await request(app.getHttpServer())
            .post(`/v1/projects/${project.id}/team/me/reject`)
            .set({ Authorization: `Bearer ${await tenant.sign({ sub: invitee.auth0Id })}` })
            .expect(200);
        } else {
          const member = await db
            .selectFrom('projectTeamMembers')
            .select('id')
            .where('projectId', '=', project.id)
            .executeTakeFirstOrThrow();
          await request(app.getHttpServer())
            .delete(`/v1/projects/${project.id}/team/${member.id}`)
            .set({ Authorization: `Bearer ${await tenant.sign({ sub: owner.auth0Id })}` })
            .expect(204);
        }
        expect((await rows())[0]?.status).toBe('dispatching');
      } finally {
        finish();
        await run;
      }
      expect((await rows())[0]).toMatchObject({
        status: 'sent',
        providerMessageId: 'delivered-after-answer',
      });
    },
  );

  it('cancellation wins over a reserved lease before dispatch', async () => {
    const { invite, project, invitee } = await people();
    await invite().expect(201);
    await db
      .updateTable('emailOutbox')
      .set({ status: 'leased', leaseToken: randomUUID(), leaseExpiresAt: new Date(0) })
      .execute();
    await request(app.getHttpServer())
      .post(`/v1/projects/${project.id}/team/me/reject`)
      .set({ Authorization: `Bearer ${await tenant.sign({ sub: invitee.auth0Id })}` })
      .expect(200);
    const fake = new FakeMailer();
    await new EmailWorker(db, cfg, fake).runBatch();
    expect(fake.accepted.size).toBe(0);
    expect((await rows())[0]?.status).toBe('canceled');
  });

  it('keeps an expired dispatch uncertain after cancellation instead of losing its outcome', async () => {
    const { invite, project, invitee } = await people();
    await invite().expect(201);
    await db
      .updateTable('emailOutbox')
      .set({
        status: 'dispatching',
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(0),
        firstAttemptAt: new Date(),
      })
      .execute();
    await request(app.getHttpServer())
      .post(`/v1/projects/${project.id}/team/me/reject`)
      .set({ Authorization: `Bearer ${await tenant.sign({ sub: invitee.auth0Id })}` })
      .expect(200);
    const fake = new FakeMailer();
    await new EmailWorker(db, cfg, fake).runBatch();
    expect(fake.accepted.size).toBe(0);
    expect((await rows())[0]?.status).toBe('uncertain');
  });

  it('refreshes the account email and verification together, preserving known state for absent claims', async () => {
    const user = await createUser(db, {
      auth0Id: `auth0|email-sync-${randomUUID()}`,
      email: 'old@example.com',
      emailVerified: false,
    });
    const http = request(app.getHttpServer());
    const me = async (profile: Record<string, unknown>) =>
      http
        .get('/v1/me')
        .set({ Authorization: `Bearer ${await tenant.sign({ sub: user.auth0Id, profile })}` })
        .expect(200);
    await me({ email: 'new@example.com', email_verified: true });
    expect(
      await db
        .selectFrom('users')
        .select(['email', 'emailVerified'])
        .where('id', '=', user.id)
        .executeTakeFirstOrThrow(),
    ).toEqual({ email: 'new@example.com', emailVerified: true });
    await me({});
    expect(
      (
        await db
          .selectFrom('users')
          .select('emailVerified')
          .where('id', '=', user.id)
          .executeTakeFirstOrThrow()
      ).emailVerified,
    ).toBe(true);
    await me({ email: 'new@example.com', email_verified: false });
    expect(
      (
        await db
          .selectFrom('users')
          .select('emailVerified')
          .where('id', '=', user.id)
          .executeTakeFirstOrThrow()
      ).emailVerified,
    ).toBe(false);
  });
  it('does not suppress a new address because an old one bounced, and bounds failed attempts', async () => {
    const { invite, invitee } = await people();
    await invite().expect(201);
    const fake = new FakeMailer();
    const worker = new EmailWorker(db, cfg, fake);
    await worker.runBatch();
    const row = (await rows())[0]!;
    await db
      .updateTable('users')
      .set({ email: 'new-inbox@example.com', emailSuppressed: false })
      .where('id', '=', invitee.id)
      .execute();
    await worker.recordFeedback(row.id, `provider-${row.id}`, 'bounced');
    expect(
      (
        await db
          .selectFrom('users')
          .select('emailSuppressed')
          .where('id', '=', invitee.id)
          .executeTakeFirstOrThrow()
      ).emailSuppressed,
    ).toBe(false);
    await db
      .updateTable('emailOutbox')
      .set({ status: 'pending', attempts: 0, destinationHash: null, nextAttemptAt: new Date(0) })
      .where('id', '=', row.id)
      .execute();
    await new EmailWorker(
      db,
      { ...cfg, EMAIL_MAX_ATTEMPTS: 1 },
      { idempotencyWindowMs: 0, send: () => Promise.reject(new MailDeliveryError('temporary')) },
    ).runBatch();
    expect((await rows())[0]?.status).toBe('failed');
  });
  it('cancels an answered invitation before re-invitation within the cooldown', async () => {
    const { invite, project, invitee } = await people();
    await invite().expect(201);
    const auth = { Authorization: `Bearer ${await tenant.sign({ sub: invitee.auth0Id })}` };
    await request(app.getHttpServer())
      .post(`/v1/projects/${project.id}/team/me/reject`)
      .set(auth)
      .expect(200);
    await invite().expect(201);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]?.status).toBe('canceled');
    const fake = new FakeMailer();
    await new EmailWorker(db, cfg, fake).runBatch();
    expect(fake.accepted.size).toBe(0);
  });
  it('scopes preferences to the caller, rejects forged fields and unsubscribes without login', async () => {
    const { invitee, owner } = await people();
    const http = request(app.getHttpServer());
    const auth = { Authorization: `Bearer ${await tenant.sign({ sub: invitee.auth0Id })}` };
    await http.get('/v1/me/email-preferences').expect(401);
    await http
      .patch('/v1/me/email-preferences')
      .set(auth)
      .send({ preferredLanguage: 'ru', teamInvitesEnabled: false })
      .expect(200, { preferredLanguage: 'ru', teamInvitesEnabled: false });
    await http
      .patch('/v1/me/email-preferences')
      .set(auth)
      .send({ userId: owner.id, preferredLanguage: 'en' })
      .expect(400);
    expect(
      (
        await db
          .selectFrom('users')
          .select('teamInviteEmailEnabled')
          .where('id', '=', owner.id)
          .executeTakeFirstOrThrow()
      ).teamInviteEmailEnabled,
    ).toBe(true);
    const token = unsubscribeToken(owner.id, secret, Date.now() + 60_000);
    await http
      .post('/v1/email/unsubscribe')
      .send({ token: token + 'x' })
      .expect(400);
    await http.post('/v1/email/unsubscribe').send({ token }).expect(200, { unsubscribed: true });
    await http.post('/v1/email/unsubscribe').send({ token }).expect(200);
    expect(
      (
        await db
          .selectFrom('users')
          .select('teamInviteEmailEnabled')
          .where('id', '=', owner.id)
          .executeTakeFirstOrThrow()
      ).teamInviteEmailEnabled,
    ).toBe(false);
    expect(logs.text()).not.toContain(token);
  });

  it('queues once for concurrent invites, honors the rolling cooldown, and rolls back with the event', async () => {
    const { invite, invitee, project, owner } = await people();
    const outcomes = await Promise.all([invite(), invite()]);
    expect(outcomes.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rows()).toHaveLength(1);
    await db
      .updateTable('projectTeamMembers')
      .set({ status: 'rejected' })
      .where('projectId', '=', project.id)
      .execute();
    await invite().expect(201);
    expect(await rows()).toHaveLength(1);
    await db
      .updateTable('emailOutbox')
      .set({ createdAt: sql<Date>`DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 25 HOUR)` })
      .execute();
    await db
      .updateTable('projectTeamMembers')
      .set({ status: 'rejected' })
      .where('projectId', '=', project.id)
      .execute();
    await invite().expect(201);
    expect(await rows()).toHaveLength(2);
    await db.deleteFrom('emailOutbox').execute();
    await expect(
      db.transaction().execute(async (trx) => {
        await enqueueInviteEmail(
          trx,
          {
            id: randomUUID(),
            recipientId: invitee.id,
            projectId: project.id,
            actorName: owner.name,
            projectTitle: project.title,
          },
          cfg,
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await rows()).toHaveLength(0);
  });

  it('does not queue for opted-out, missing-email, unverified or suppressed users', async () => {
    for (const over of [
      { teamInviteEmailEnabled: false },
      { email: null },
      { emailVerified: false },
      { emailSuppressed: true },
    ]) {
      const { invitee, invite } = await people();
      await db.updateTable('users').set(over).where('id', '=', invitee.id).execute();
      await invite().expect(201);
    }
    expect(await rows()).toEqual([]);
  });

  it('delivers after commit once under concurrent workers, and suppresses opted-out pending work', async () => {
    const { invite, invitee } = await people();
    await invite().expect(201);
    const fake = new FakeMailer();
    await Promise.all([
      new EmailWorker(db, cfg, fake).runBatch(),
      new EmailWorker(db, cfg, fake).runBatch(),
    ]);
    expect(fake.accepted.size).toBe(1);
    expect((await rows())[0]?.status).toBe('sent');
    expect([...fake.accepted.values()][0]?.subject).toContain('հրավեր');
    await db.updateTable('emailOutbox').set({ status: 'pending' }).execute();
    await db
      .updateTable('users')
      .set({ teamInviteEmailEnabled: false })
      .where('id', '=', invitee.id)
      .execute();
    await new EmailWorker(db, cfg, fake).runBatch();
    expect((await rows())[0]?.status).toBe('canceled');
    expect(fake.accepted.size).toBe(1);
    expect(logs.text()).not.toContain('private-inbox@example.com');
  });

  it('retries definite non-acceptance, quarantines unknown outcomes and handles signed-adapter feedback', async () => {
    const { invite, invitee } = await people();
    await invite().expect(201);
    const temporary: Mailer = {
      idempotencyWindowMs: 0,
      send: () => Promise.reject(new MailDeliveryError('temporary')),
    };
    await new EmailWorker(db, cfg, temporary).runBatch();
    expect((await rows())[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      failureCode: 'TEMPORARY',
    });
    await db
      .updateTable('emailOutbox')
      .set({ nextAttemptAt: new Date(0) })
      .execute();
    await new EmailWorker(db, cfg, {
      idempotencyWindowMs: 0,
      send: () => Promise.reject(new Error('secret provider body')),
    }).runBatch();
    const row = (await rows())[0]!;
    expect(row.status).toBe('uncertain');
    const worker = new EmailWorker(db, cfg, new FakeMailer());
    await worker.recordFeedback(row.id, 'provider-id', 'bounced');
    await worker.recordFeedback(row.id, 'provider-id', 'bounced');
    expect((await rows())[0]?.status).toBe('bounced');
    expect(
      (
        await db
          .selectFrom('users')
          .select('emailSuppressed')
          .where('id', '=', invitee.id)
          .executeTakeFirstOrThrow()
      ).emailSuppressed,
    ).toBe(true);
    expect(logs.text()).not.toContain('secret provider body');
  });

  it('reuses a stable delivery key and body after a crash with provider acceptance', async () => {
    const { invite } = await people();
    await invite().expect(201);
    const fake = new FakeMailer();
    await new EmailWorker(db, cfg, fake).runBatch();
    // Simulate the DB acknowledgment being lost after acceptance: the old claim expires.
    await db
      .updateTable('emailOutbox')
      .set({ status: 'dispatching', leaseToken: randomUUID(), leaseExpiresAt: new Date(0) })
      .execute();
    await new EmailWorker(db, cfg, fake).runBatch();
    expect(fake.accepted.size).toBe(1);
    expect((await rows())[0]?.status).toBe('sent');
  });

  it('leaves delivery disabled and removes pending work when its account is deleted', async () => {
    const { invite, invitee } = await people();
    await invite().expect(201);
    const fake = new FakeMailer();
    expect(
      await new EmailWorker(db, { ...cfg, EMAIL_DELIVERY_ENABLED: false }, fake).runBatch(),
    ).toMatchObject({ disabled: true });
    expect(fake.accepted.size).toBe(0);
    await db.deleteFrom('users').where('id', '=', invitee.id).execute();
    expect(await rows()).toEqual([]);
  });
});
