import { describe, expect, it } from 'vitest';
import {
  domainMatches,
  educationKey,
  entriesToOffer,
  entryIsGone,
  organizationKey,
  type UniversityConfig,
} from './education-rules.js';

const NAME = 'National Polytechnic University of Armenia';
const cfg: UniversityConfig = {
  domains: ['polytechnic.am'],
  name: NAME,
  orgs: { 'poly-club': 'Polytechnic Club' },
};
const none = { institutions: [], organizations: [] };

describe('domainMatches', () => {
  it.each([
    'student@polytechnic.am',
    'student@POLYTECHNIC.AM',
    'student@cs.polytechnic.am',
    'a.b@lab.cs.Polytechnic.am',
    // The part after the LAST "@": an earlier one is just part of the local part.
    '"x@evil.com"@polytechnic.am',
  ])('%s is on polytechnic.am', (address) => {
    expect(domainMatches(address, cfg.domains)).toBe(true);
  });

  it.each([
    'student@evilpolytechnic.am',
    'student@polytechnic.am.evil.com',
    'student@polytechnic.amx',
    'student@xpolytechnic.am',
    'student@polytechnic.am.',
    'student@.polytechnic.am',
    'polytechnic.am',
    '@polytechnic.am',
    'student@evil.com',
    'student@polytechnic.am@evil.com',
    '',
  ])('%s is not', (address) => {
    expect(domainMatches(address, cfg.domains)).toBe(false);
  });

  it('no domain configured matches nothing', () => {
    expect(domainMatches('student@polytechnic.am', [])).toBe(false);
  });
});

describe('entriesToOffer', () => {
  const verified = { institutionVerified: true, orgLogins: ['poly-club'] };

  it('offers the institution and the configured organisation', () => {
    expect(entriesToOffer(verified, cfg, none)).toEqual([
      {
        kind: 'education.add',
        dedupeKey: educationKey(NAME),
        payload: { field: 'education', value: NAME },
      },
      {
        kind: 'experience.add',
        dedupeKey: organizationKey('poly-club'),
        payload: { field: 'experience', value: 'Polytechnic Club' },
      },
    ]);
  });

  it('offers nothing without evidence', () => {
    expect(entriesToOffer({ institutionVerified: false, orgLogins: [] }, cfg, none)).toEqual([]);
    expect(
      entriesToOffer({ institutionVerified: undefined, orgLogins: undefined }, cfg, none),
    ).toEqual([]);
  });

  it('is empty-state only: an entry for the same name, in any case or spacing, blocks it', () => {
    const held = {
      institutions: ['  national POLYTECHNIC university  of armenia'],
      organizations: ['polytechnic club'],
    };
    expect(entriesToOffer(verified, cfg, held)).toEqual([]);
    // A different institution does not block it.
    expect(
      entriesToOffer(verified, cfg, {
        institutions: ['Yerevan State University'],
        organizations: [],
      }),
    ).toHaveLength(2);
  });

  it('an organisation GitHub shows but the config does not list is never offered', () => {
    expect(
      entriesToOffer({ institutionVerified: false, orgLogins: ['somebody-else'] }, cfg, none),
    ).toEqual([]);
  });
});

describe('entryIsGone', () => {
  const edu = { kind: 'education.add', payload: { field: 'education', value: NAME } };
  const known = { institution: false, organizations: false };

  it('is kept while GitHub was not asked, withdrawn once asked and not wanted', () => {
    expect(entryIsGone(edu, cfg, none, known)).toBe(false);
    expect(entryIsGone(edu, cfg, none, { ...known, institution: true })).toBe(true);
  });

  it('is withdrawn when the profile holds the entry, or the config stops offering it', () => {
    expect(entryIsGone(edu, cfg, { institutions: [NAME], organizations: [] }, known)).toBe(true);
    expect(entryIsGone(edu, { ...cfg, name: 'Another University' }, none, known)).toBe(true);
    const org = {
      kind: 'experience.add',
      payload: { field: 'experience', value: 'Polytechnic Club' },
    };
    expect(entryIsGone(org, cfg, none, known)).toBe(false);
    expect(entryIsGone(org, { ...cfg, orgs: {} }, none, known)).toBe(true);
  });
});
