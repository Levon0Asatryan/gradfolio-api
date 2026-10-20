import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readUnsubscribeToken, unsubscribeToken } from './unsubscribe.js';
import { inviteEmail } from './templates.js';
import { testConfig } from '../../testing/database.js';
import { DisabledMailer, MailDeliveryError } from './mailer.js';

describe('invitation email safety', () => {
  it('rejects oversized, malformed and correctly signed tokens for a different purpose', () => {
    const secret = 's'.repeat(32);
    const userId = randomUUID();
    const payload = { purpose: 'team-invite-email', userId, expiresAt: Date.now() + 60_000 };
    const sign = (text: string) => {
      const encoded = Buffer.from(text).toString('base64url');
      return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
    };
    expect(readUnsubscribeToken(sign(JSON.stringify(payload)), secret)).toBe(userId);
    expect(
      readUnsubscribeToken(sign(JSON.stringify({ ...payload, purpose: 'password-reset' })), secret),
    ).toBeUndefined();
    expect(readUnsubscribeToken(sign('{broken-json'), secret)).toBeUndefined();
    for (const token of ['', 'missing-signature', 'a.b.c', 'x'.repeat(1001)]) {
      expect(readUnsubscribeToken(token, secret)).toBeUndefined();
    }
  });
  it('keeps the default mailer disabled with a safe failure', async () => {
    const mailer = new DisabledMailer();
    expect(mailer.idempotencyWindowMs).toBe(0);
    await expect(
      mailer.send({
        to: 'test@example.com',
        subject: 'test',
        text: 'test',
        html: 'test',
        idempotencyKey: 'id',
      }),
    ).rejects.toBeInstanceOf(MailDeliveryError);
  });
  it('uses a signed, expiring, single-purpose token without exposing an address', () => {
    const id = randomUUID();
    const secret = 's'.repeat(32);
    const token = unsubscribeToken(id, secret, 2000);
    expect(readUnsubscribeToken(token, secret, 1000)).toBe(id);
    expect(readUnsubscribeToken(token, secret, 2000)).toBeUndefined();
    expect(readUnsubscribeToken(token + 'x', secret, 1000)).toBeUndefined();
    expect(readUnsubscribeToken(token, 'x'.repeat(32), 1000)).toBeUndefined();
  });
  it.each(['en', 'ru', 'am'] as const)(
    'escapes names and titles in %s, with plain text and login-required /teams',
    (language) => {
      const content = inviteEmail(
        language,
        '<script>Actor</script>',
        '"Project" & team',
        'https://app.example',
        'token',
      );
      expect(content.html).not.toContain('<script>');
      expect(content.html).toContain('&lt;script&gt;');
      expect(content.html).toContain('https://app.example/teams');
      expect(content.text).toContain('/email/unsubscribe#token');
      expect(content.text).not.toContain('/accept');
    },
  );
  it('defaults delivery off and rejects invalid enabled settings', () => {
    expect(testConfig().EMAIL_DELIVERY_ENABLED).toBe(false);
    expect(() => testConfig({ EMAIL_DELIVERY_ENABLED: 'true' })).toThrow();
    expect(() =>
      testConfig({ NODE_ENV: 'production', EMAIL_PUBLIC_URL: 'http://app.example' }),
    ).toThrow();
    expect(() => testConfig({ EMAIL_LEASE_S: '30', EMAIL_SEND_TIMEOUT_MS: '30000' })).toThrow();
    expect(() => testConfig({ EMAIL_UNSUBSCRIBE_TTL_S: '3600' })).toThrow();
    expect(() =>
      testConfig({ EMAIL_RETENTION_DAYS: '2', EMAIL_INVITE_COOLDOWN_S: String(3 * 86400) }),
    ).toThrow();
  });
});
