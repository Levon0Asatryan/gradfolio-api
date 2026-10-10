import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';

/** The header that carries the shared secret (docs/m6-plan.md §2.4). */
export const PROXY_SECRET_HEADER = 'x-gradfolio-proxy-secret';
/** The real client's address, believed only together with a valid secret. */
export const CLIENT_IP_HEADER = 'x-client-ip';

/**
 * Whose budget a request counts against.
 *
 * - `user`: a verified token; the `sub`.
 * - `forwarded`: no token, but the frontend's server vouched for the visitor's
 *   address with the shared secret.
 * - `address`: neither; the connection's address (the frontend's own egress
 *   when it did not forward one), which every such visitor shares.
 */
export type ClientIdentity =
  { kind: 'user'; sub: string } | { kind: 'forwarded'; ip: string } | { kind: 'address' };

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Secrets as fixed-length digests, so the comparison does not depend on their length. */
export function secretDigests(secrets: readonly string[]): Buffer[] {
  return secrets.map(digest);
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Pure: reads only the request. The secret is compared in constant time against
 * every configured one (two while rotating); a wrong, missing or repeated
 * header, and an address that is not an IP literal, all fall back to `address`
 * -- never to "unlimited".
 */
export function identify(
  req: Request & { auth?: AccessTokenIdentity },
  secrets: readonly Buffer[],
): ClientIdentity {
  if (req.auth) return { kind: 'user', sub: req.auth.sub };
  if (secrets.length === 0) return { kind: 'address' };
  const given = header(req, PROXY_SECRET_HEADER);
  const ip = header(req, CLIENT_IP_HEADER);
  if (given === undefined || ip === undefined) return { kind: 'address' };
  const candidate = digest(given);
  // Compare against all of them, so the time does not reveal which one matched.
  let ok = false;
  for (const s of secrets) ok = timingSafeEqual(candidate, s) || ok;
  if (!ok || isIP(ip) === 0) return { kind: 'address' };
  return { kind: 'forwarded', ip };
}
