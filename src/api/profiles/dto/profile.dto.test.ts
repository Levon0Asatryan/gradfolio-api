import { describe, expect, it } from 'vitest';
import { updateProfileSchema } from './profile.dto.js';

const parse = (v: unknown) => updateProfileSchema.safeParse(v);

describe('updateProfileSchema', () => {
  it('accepts any single field', () => {
    expect(parse({ name: 'Ani' }).success).toBe(true);
    expect(parse({ isPublic: false }).success).toBe(true);
    expect(parse({ links: { github: 'https://github.com/ani' } }).success).toBe(true);
  });

  it.each([{}, { links: {} }, { links: { github: undefined } }])(
    'refuses a patch that changes nothing: %j',
    (body) => {
      expect(parse(body).success).toBe(false);
    },
  );

  it.each([
    'verified',
    'email',
    'auth0Id',
    'auth0_id',
    'phone',
    'birthday',
    'id',
    'createdAt',
    'onboardedAt',
    'github',
  ])('rejects the unknown key %s instead of ignoring or writing it', (key) => {
    expect(parse({ name: 'Ani', [key]: 'x' }).success).toBe(false);
  });

  it('rejects an unknown key inside links', () => {
    expect(
      parse({ links: { github: 'https://a.example', facebook: 'https://b.example' } }).success,
    ).toBe(false);
  });

  it('trims, and turns a blank nullable field into null', () => {
    expect(parse({ name: '  Ani  ', bio: '   ', location: '' })).toMatchObject({
      success: true,
      data: { name: 'Ani', bio: null, location: null },
    });
  });

  it('keeps null as a clear for nullable fields but refuses it for name and headline', () => {
    expect(parse({ bio: null, avatarUrl: null, contactEmail: null }).success).toBe(true);
    expect(parse({ name: null }).success).toBe(false);
    expect(parse({ headline: null }).success).toBe(false);
    expect(parse({ isPublic: null }).success).toBe(false);
  });

  it('refuses an empty name but allows an empty headline', () => {
    expect(parse({ name: '   ' }).success).toBe(false);
    expect(parse({ headline: '' }).success).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example', '/relative', 'not a url'])(
    'refuses %s as a URL field',
    (url) => {
      expect(parse({ avatarUrl: url }).success).toBe(false);
      expect(parse({ links: { website: url } }).success).toBe(false);
    },
  );

  it('measures lengths as MySQL does: 500 emoji fit a VARCHAR(500)', () => {
    expect(parse({ headline: '😀'.repeat(500) }).success).toBe(true);
    expect(parse({ headline: '😀'.repeat(501) }).success).toBe(false);
    expect(parse({ name: 'x'.repeat(256) }).success).toBe(false);
  });

  it('checks the contact email', () => {
    expect(parse({ contactEmail: 'ani@example.com' }).success).toBe(true);
    expect(parse({ contactEmail: 'not-an-email' }).success).toBe(false);
    expect(parse({ contactEmail: `${'a'.repeat(250)}@example.com` }).success).toBe(false);
  });
});
