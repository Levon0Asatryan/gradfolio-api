import { describe, expect, it } from 'vitest';
import type { AccessTokenIdentity } from '../../../core/auth/access-token.js';
import { FALLBACK_NAME, hasProfileClaims, prefillFrom } from './prefill.js';

const identity = (over: Partial<AccessTokenIdentity> = {}): AccessTokenIdentity => ({
  sub: 'google-oauth2|1',
  emailVerified: false,
  identities: [],
  ...over,
});

describe('prefillFrom', () => {
  it('takes name, email, picture and verified from the claims', () => {
    expect(
      prefillFrom(
        identity({
          name: '  Ani Petrosyan ',
          email: 'ani@example.com',
          picture: 'https://lh3.googleusercontent.com/a/x',
          emailVerified: true,
        }),
      ),
    ).toEqual({
      name: 'Ani Petrosyan',
      email: 'ani@example.com',
      avatarUrl: 'https://lh3.googleusercontent.com/a/x',
      headline: '',
      verified: true,
    });
  });

  it('falls back to the email local part, then to a fixed name', () => {
    expect(prefillFrom(identity({ email: 'student@npua.am' })).name).toBe('student');
    expect(prefillFrom(identity({ name: '   ', email: 'student@npua.am' })).name).toBe('student');
    expect(prefillFrom(identity()).name).toBe(FALLBACK_NAME);
  });

  it('does not use a name that is an email address (an Auth0 database login names the user by email)', () => {
    const db = { sub: 'auth0|1', emailVerified: true };
    expect(
      prefillFrom(identity({ ...db, name: 'ani@example.com', email: 'ani@example.com' })).name,
    ).toBe('ani');
    expect(
      prefillFrom(identity({ ...db, name: ' Ani.P@Example.com ', email: 'other@example.com' }))
        .name,
    ).toBe('other');
    expect(prefillFrom(identity({ ...db, name: 'ani@example.com' })).name).toBe(FALLBACK_NAME);
    // a real name that merely contains an @ is kept
    expect(
      prefillFrom(identity({ ...db, name: 'Ani @ NPUA', email: 'ani@example.com' })).name,
    ).toBe('Ani @ NPUA');
  });

  it('cuts a name to 255 characters, counted as MySQL counts them (code points)', () => {
    const name = prefillFrom(identity({ name: '😀'.repeat(300) })).name;
    expect([...name]).toHaveLength(255);
    expect(name).toBe('😀'.repeat(255));
  });

  it('drops an email that is not one, or that is longer than the column', () => {
    expect(prefillFrom(identity({ email: 'not-an-email' })).email).toBeNull();
    expect(prefillFrom(identity({ email: `${'a'.repeat(250)}@x.com` })).email).toBeNull();
  });

  it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', '/relative.png', 'not a url'])(
    'drops the picture %j: only http(s) URLs are stored',
    (picture) => {
      expect(prefillFrom(identity({ picture })).avatarUrl).toBeNull();
    },
  );

  it('takes a headline only from a LinkedIn identity, cut to 500 characters', () => {
    const long = 'h'.repeat(600);
    expect(prefillFrom(identity({ sub: 'linkedin|abc', headline: long })).headline).toBe(
      'h'.repeat(500),
    );
    expect(prefillFrom(identity({ sub: 'google-oauth2|1', headline: 'Engineer' })).headline).toBe(
      '',
    );
    expect(prefillFrom(identity({ sub: 'linkedin|abc' })).headline).toBe('');
  });
});

describe('hasProfileClaims', () => {
  it('is true when the Action put any profile claim on the token', () => {
    expect(hasProfileClaims(identity({ email: 'a@b.c' }))).toBe(true);
    expect(hasProfileClaims(identity({ name: 'A' }))).toBe(true);
    expect(hasProfileClaims(identity({ picture: 'https://x' }))).toBe(true);
    expect(hasProfileClaims(identity())).toBe(false);
  });
});
