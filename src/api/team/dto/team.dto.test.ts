import { describe, expect, it } from 'vitest';
import { addExternalMemberSchema, inviteMemberSchema, lookupQuerySchema } from './team.dto.js';

describe('team request schemas', () => {
  it('invite: role defaults to null, text is trimmed, a blank role clears it', () => {
    expect(inviteMemberSchema.parse({ userId: 'u' })).toEqual({ userId: 'u', role: null });
    expect(inviteMemberSchema.parse({ userId: 'u', role: '  QA ' }).role).toBe('QA');
    expect(inviteMemberSchema.parse({ userId: 'u', role: '   ' }).role).toBeNull();
  });

  it.each([
    [{}],
    [{ userId: '' }],
    [{ userId: 'x'.repeat(37) }],
    [{ userId: 'u', status: 'accepted' }], // a status can never be sent
    [{ userId: 'u', role: 'x'.repeat(256) }],
  ])('invite refuses %j', (body) => {
    expect(inviteMemberSchema.safeParse(body).success).toBe(false);
  });

  it('external: needs a non-blank name and takes nothing else', () => {
    expect(addExternalMemberSchema.parse({ name: ' Aram ' })).toEqual({ name: 'Aram', role: null });
    for (const body of [
      {},
      { name: '  ' },
      { name: 'x'.repeat(256) },
      { name: 'A', userId: 'u' },
      { name: 'A', status: 'pending' },
    ]) {
      expect(addExternalMemberSchema.safeParse(body).success).toBe(false);
    }
  });

  it('lookup: at least 3 characters after trimming, at most 50, nothing else', () => {
    expect(lookupQuerySchema.parse({ q: ' ani ' }).q).toBe('ani');
    for (const q of [
      {},
      { q: 'ab' },
      { q: ' ab ' },
      { q: 'x'.repeat(51) },
      { q: 'abc', extra: 1 },
    ]) {
      expect(lookupQuerySchema.safeParse(q).success).toBe(false);
    }
  });
});
