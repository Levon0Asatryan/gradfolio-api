import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';

export const sendgridEventsSchema = z
  .array(
    z
      .object({
        event: z.string().min(1).max(100),
        outbox_id: z.uuid().optional(),
        sg_message_id: z.string().min(1).max(255).optional(),
      })
      .passthrough(),
  )
  .max(1000);

/** SendGrid signs SHA256(timestamp + exact body) with an ECDSA key. */
export function verifySendGridWebhook(
  body: Buffer,
  headers: { timestamp?: string; signature?: string },
  publicKey: string,
  now = Date.now(),
): boolean {
  const { timestamp, signature } = headers;
  if (
    !timestamp ||
    !/^\d{1,12}$/.test(timestamp) ||
    !signature ||
    signature.length > 512 ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (key.asymmetricKeyType !== 'ec') return false;
    return verify(
      'sha256',
      Buffer.concat([Buffer.from(timestamp), body]),
      key,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}
