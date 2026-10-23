import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const resendEventSchema = z
  .object({
    type: z.string().min(1).max(100),
    data: z
      .object({
        email_id: z.uuid().optional(),
        tags: z.record(z.string(), z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Svix protocol: https://docs.svix.com/receiving/verifying-payloads/how-manual */
export function verifyResendWebhook(
  body: Buffer,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (
    !id ||
    id.length > 200 ||
    !timestamp ||
    !/^\d{1,12}$/.test(timestamp) ||
    !signature ||
    signature.length > 2048 ||
    !secret.startsWith('whsec_')
  )
    return false;
  // Five minutes, as in the Svix libraries. Reject future as well as old requests.
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
    .update(`${id}.${timestamp}.`)
    .update(body)
    .digest();
  return signature.split(' ').some((entry) => {
    const [version, encoded] = entry.split(',');
    if (version !== 'v1' || !encoded) return false;
    const actual = Buffer.from(encoded, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
