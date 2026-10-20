import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f-]{36}$/;

export function unsubscribeToken(userId: string, secret: string, expiresAt: number): string {
  const payload = Buffer.from(
    JSON.stringify({ purpose: 'team-invite-email', userId, expiresAt }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function readUnsubscribeToken(
  token: string,
  secret: string,
  now = Date.now(),
): string | undefined {
  if (token.length > 1000) return undefined;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return undefined;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    if (
      value.purpose !== 'team-invite-email' ||
      typeof value.userId !== 'string' ||
      !UUID.test(value.userId) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now
    )
      return undefined;
    return value.userId;
  } catch {
    return undefined;
  }
}
