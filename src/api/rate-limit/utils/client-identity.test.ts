import { describe, expect, it } from 'vitest';
import { identify, secretDigests } from './client-identity.js';

const SECRET = 's'.repeat(40);
const PREVIOUS = 'p'.repeat(40);
const secrets = secretDigests([SECRET, PREVIOUS]);

const req = (headers: Record<string, string | string[]>, auth?: { sub: string }) =>
  ({ headers, auth }) as unknown as Parameters<typeof identify>[0];

describe('identify', () => {
  it('uses the verified sub before anything else, even with a valid secret', () => {
    const r = req(
      { 'x-gradfolio-proxy-secret': SECRET, 'x-client-ip': '203.0.113.5' },
      { sub: 'u1' },
    );
    expect(identify(r, secrets)).toEqual({ kind: 'user', sub: 'u1' });
  });

  it('believes the forwarded address with the current or the previous secret', () => {
    for (const s of [SECRET, PREVIOUS]) {
      expect(
        identify(req({ 'x-gradfolio-proxy-secret': s, 'x-client-ip': '203.0.113.5' }), secrets),
      ).toEqual({ kind: 'forwarded', ip: '203.0.113.5' });
    }
    expect(
      identify(req({ 'x-gradfolio-proxy-secret': SECRET, 'x-client-ip': '2001:db8::1' }), secrets),
    ).toEqual({ kind: 'forwarded', ip: '2001:db8::1' });
  });

  it.each([
    [
      'a wrong secret',
      { 'x-gradfolio-proxy-secret': 'x'.repeat(40), 'x-client-ip': '203.0.113.5' },
    ],
    ['no secret', { 'x-client-ip': '203.0.113.5' }],
    ['no address', { 'x-gradfolio-proxy-secret': SECRET }],
    ['a garbage address', { 'x-gradfolio-proxy-secret': SECRET, 'x-client-ip': 'not an ip' }],
    ['a hostname', { 'x-gradfolio-proxy-secret': SECRET, 'x-client-ip': 'example.com' }],
    [
      'a repeated header',
      { 'x-gradfolio-proxy-secret': [SECRET, SECRET], 'x-client-ip': '203.0.113.5' },
    ],
    ['an empty secret', { 'x-gradfolio-proxy-secret': '', 'x-client-ip': '203.0.113.5' }],
  ])('falls back to the connection address for %s', (_n, headers) => {
    expect(identify(req(headers), secrets)).toEqual({ kind: 'address' });
  });

  it('ignores the headers entirely when no secret is configured', () => {
    expect(
      identify(
        req({ 'x-gradfolio-proxy-secret': SECRET, 'x-client-ip': '203.0.113.5' }),
        secretDigests([]),
      ),
    ).toEqual({ kind: 'address' });
  });
});
