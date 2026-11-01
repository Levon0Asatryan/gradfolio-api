import { describe, expect, it } from 'vitest';
import type { ZipReadResult } from '../../../core/linkedin-export/zip-reader.js';
import { certificationKey, educationKey, experienceKey, skillKey } from './linkedin-keys.js';
import { buildPreview, type ExistingProfile } from './linkedin-preview.js';

const none: ExistingProfile = { experience: [], education: [], certifications: [], skills: [] };

const exp = (
  over: Record<string, unknown> = {},
  problems: { field: string; code: string }[] = [],
) => ({
  fields: {
    title: 'Dev',
    organization: 'Acme',
    start: '2022-09',
    end: null,
    summary: '',
    achievements: [],
    skills: [],
    ...over,
  },
  problems,
});

const read = (over: Record<string, unknown>): ZipReadResult => ({
  outcomes: over,
  skippedColumns: [],
  missingFiles: [],
  skippedFileCount: 0,
  extensions: {},
});

describe('natural keys', () => {
  it('fold case, accents-as-NFC and whitespace; a missing part gives no key', () => {
    expect(experienceKey({ title: ' Dev  Ops ', organization: 'ACME', start: '2022-09' })).toBe(
      experienceKey({ title: 'dev ops', organization: 'acme', start: '2022-09' }),
    );
    expect(experienceKey({ title: 'é', organization: 'a', start: '2022-09' })).toBe(
      experienceKey({ title: 'é', organization: 'a', start: '2022-09' }),
    );
    expect(experienceKey({ title: 'Dev', organization: 'Acme', start: null })).toBeNull();
    expect(educationKey({ institution: 'U', degree: '', startYear: 2019 })).toBeNull();
    expect(educationKey({ institution: 'U', degree: 'BSc', startYear: null })).toBeNull();
    expect(certificationKey({ name: 'C', issuer: 'I', date: null })).toBeNull();
    expect(skillKey('  Type  Script ')).toBe('type script');
  });

  it('differ when any part differs', () => {
    const base = { title: 'Dev', organization: 'Acme', start: '2022-09' };
    expect(experienceKey(base)).not.toBe(experienceKey({ ...base, start: '2022-10' }));
    expect(experienceKey(base)).not.toBe(experienceKey({ ...base, organization: 'Acme2' }));
  });
});

describe('buildPreview', () => {
  it('a complete item is new', () => {
    const out = buildPreview(read({ positions: { items: [exp()] } }), none);
    expect(out.experience).toEqual([{ status: 'new', fields: exp().fields, problems: [] }]);
  });

  it('an item equal to an existing row on the key is a duplicate, in any spelling', () => {
    const existing = {
      ...none,
      experience: [{ title: 'DEV', organization: 'acme ', start: '2022-09' }],
    };
    const out = buildPreview(read({ positions: { items: [exp()] } }), existing);
    expect(out.experience[0]).toMatchObject({ status: 'duplicate', problems: [] });
  });

  it('a repeat inside the file is a duplicate of the first, which stays new', () => {
    const out = buildPreview(read({ positions: { items: [exp(), exp()] } }), none);
    expect(out.experience.map((i) => i.status)).toEqual(['new', 'duplicate']);
  });

  it('a duplicate wins over a problem; a problem without a key match is invalid', () => {
    const existing = {
      ...none,
      experience: [{ title: 'Dev', organization: 'Acme', start: '2022-09' }],
    };
    const out = buildPreview(
      read({
        positions: {
          items: [
            exp({}, [{ field: 'summary', code: 'REQUIRED' }]),
            exp({ start: null, title: 'Other' }, [{ field: 'start', code: 'DATE_NEEDS_MONTH' }]),
          ],
        },
      }),
      existing,
    );
    expect(out.experience[0]?.status).toBe('duplicate');
    expect(out.experience[1]).toMatchObject({
      status: 'invalid',
      problems: [{ field: 'start', code: 'DATE_NEEDS_MONTH' }],
    });
  });

  it('applies the manual-entry schema: an over-long title is invalid even with no parser problem', () => {
    const out = buildPreview(
      read({ positions: { items: [exp({ title: 'x'.repeat(501) })] } }),
      none,
    );
    expect(out.experience[0]).toMatchObject({
      status: 'invalid',
      problems: [{ field: 'title', code: 'INVALID' }],
    });
  });

  it('does not repeat a field the parser already flagged', () => {
    const out = buildPreview(
      read({ positions: { items: [exp({ title: '' }, [{ field: 'title', code: 'REQUIRED' }])] } }),
      none,
    );
    expect(out.experience[0]?.problems).toEqual([{ field: 'title', code: 'REQUIRED' }]);
  });

  it('education is invalid until the student gives a field; certifications by name, issuer, date', () => {
    const edu = {
      fields: {
        institution: 'U',
        degree: 'BSc',
        field: '',
        startYear: 2019,
        endYear: 2023,
        description: null,
        highlights: [],
      },
      problems: [{ field: 'field', code: 'REQUIRED' as const }],
    };
    const cert = {
      fields: { name: 'C', issuer: 'I', date: '2023-03', credentialUrl: null },
      problems: [],
    };
    const out = buildPreview(
      read({ education: { items: [edu] }, certifications: { items: [cert, cert] } }),
      none,
    );
    expect(out.education[0]).toMatchObject({ status: 'invalid' });
    expect(out.certifications.map((i) => i.status)).toEqual(['new', 'duplicate']);
    const existing = { ...none, certifications: [{ name: 'c', issuer: 'i', date: '2023-03' }] };
    expect(
      buildPreview(read({ certifications: { items: [cert] } }), existing).certifications[0]?.status,
    ).toBe('duplicate');
  });

  it('skills: duplicates of the profile and of the file, case-insensitive; an over-long one is invalid', () => {
    const items = ['TypeScript', 'SQL', 'sql', 'x'.repeat(300)].map((name) => ({
      fields: { name },
      problems: [],
    }));
    const out = buildPreview(read({ skills: { items } }), { ...none, skills: ['typescript'] });
    expect(out.skills.map((s) => s.status)).toEqual(['duplicate', 'new', 'duplicate', 'invalid']);
  });

  it('a missing dataset gives an empty section', () => {
    expect(buildPreview(read({}), none)).toEqual({
      experience: [],
      education: [],
      certifications: [],
      skills: [],
    });
  });
});
