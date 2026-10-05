import { describe, expect, it } from 'vitest';
import {
  createCertificationSchema,
  createEducationSchema,
  createExperienceSchema,
  nonEmptyPatch,
  patchEducationSchema,
  patchExperienceSchema,
  reorderSchema,
  replaceSkillsSchema,
} from './section.dto.js';

const edu = { institution: 'NPUA', degree: 'BSc', field: 'CS', startYear: 2022 };
const exp = { title: 'Intern', organization: 'Picsart', start: '2024-06', summary: '' };
const cert = { name: 'AWS', issuer: 'AWS', date: '2025-01' };

describe('education', () => {
  it('fills the optional fields with their empty values', () => {
    expect(createEducationSchema.parse(edu)).toEqual({
      ...edu,
      endYear: null,
      description: null,
      highlights: [],
    });
  });

  it.each([
    [{ ...edu, institution: '' }],
    [{ ...edu, degree: '   ' }],
    [{ ...edu, startYear: 1899 }],
    [{ ...edu, startYear: 2101 }],
    [{ ...edu, startYear: 2022.5 }],
    [{ ...edu, endYear: 2021 }],
    [{ ...edu, highlights: Array.from({ length: 21 }, () => 'x') }],
    [{ ...edu, highlights: [''] }],
    [{ ...edu, institution: 'x'.repeat(501) }],
    [{ ...edu, id: 'abc' }],
    [{ ...edu, userId: 'abc' }],
    [{ ...edu, sortOrder: 3 }],
  ])('refuses %j', (body) => {
    expect(createEducationSchema.safeParse(body).success).toBe(false);
  });

  it('allows an end year equal to the start year, and a blank description becomes null', () => {
    expect(createEducationSchema.parse({ ...edu, endYear: 2022, description: '  ' })).toMatchObject(
      {
        endYear: 2022,
        description: null,
      },
    );
  });

  it('a patch is a strict subset, and may not be empty', () => {
    expect(patchEducationSchema.safeParse({ degree: 'MSc' }).success).toBe(true);
    expect(patchEducationSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(nonEmptyPatch(patchEducationSchema).safeParse({}).success).toBe(false);
  });
});

describe('experience', () => {
  it('takes months, and null for present; "Present" is not a month', () => {
    expect(createExperienceSchema.parse(exp)).toMatchObject({ end: null, skills: [] });
    expect(createExperienceSchema.safeParse({ ...exp, end: 'Present' }).success).toBe(false);
    expect(createExperienceSchema.safeParse({ ...exp, start: '2024-13' }).success).toBe(false);
    expect(createExperienceSchema.safeParse({ ...exp, start: '2024-6' }).success).toBe(false);
  });

  it('refuses an end before the start, accepts equal months', () => {
    expect(createExperienceSchema.safeParse({ ...exp, end: '2024-05' }).success).toBe(false);
    expect(createExperienceSchema.safeParse({ ...exp, end: '2024-06' }).success).toBe(true);
  });

  it('allows an empty summary but not an empty title', () => {
    expect(createExperienceSchema.safeParse({ ...exp, summary: '' }).success).toBe(true);
    expect(createExperienceSchema.safeParse({ ...exp, title: '' }).success).toBe(false);
  });

  it('normalizes skills and caps them', () => {
    expect(
      createExperienceSchema.parse({ ...exp, skills: ['  React  ', 'Node  js'] }).skills,
    ).toEqual(['React', 'Node js']);
    expect(
      createExperienceSchema.safeParse({
        ...exp,
        skills: Array.from({ length: 31 }, (_, i) => `s${i}`),
      }).success,
    ).toBe(false);
    expect(createExperienceSchema.safeParse({ ...exp, skills: ['  '] }).success).toBe(false);
  });

  it('a patch of one field is valid alone; the whole is validated by the service', () => {
    expect(patchExperienceSchema.safeParse({ end: '2020-01' }).success).toBe(true);
  });
});

describe('certification', () => {
  it('requires a month and takes only http(s) credential URLs', () => {
    expect(createCertificationSchema.parse(cert)).toMatchObject({ credentialUrl: null });
    for (const credentialUrl of ['javascript:alert(1)', 'data:text/html,x', '/x', 'x']) {
      expect(createCertificationSchema.safeParse({ ...cert, credentialUrl }).success).toBe(false);
    }
    expect(
      createCertificationSchema.safeParse({ ...cert, credentialUrl: 'https://c.example/1' })
        .success,
    ).toBe(true);
    expect(createCertificationSchema.safeParse({ ...cert, date: '2025' }).success).toBe(false);
  });
});

describe('reorder and skills bodies', () => {
  it('refuses a repeated id and unknown keys', () => {
    expect(reorderSchema.safeParse({ ids: ['a', 'b'] }).success).toBe(true);
    expect(reorderSchema.safeParse({ ids: ['a', 'a'] }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: [], extra: 1 }).success).toBe(false);
    expect(reorderSchema.safeParse({ ids: ['x'.repeat(37)] }).success).toBe(false);
  });

  it('normalizes skill names and refuses blanks and extra keys', () => {
    expect(replaceSkillsSchema.parse({ skills: [' React ', 'Go'] }).skills).toEqual([
      'React',
      'Go',
    ]);
    expect(replaceSkillsSchema.safeParse({ skills: [''] }).success).toBe(false);
    expect(replaceSkillsSchema.safeParse({ skills: [], userId: 'x' }).success).toBe(false);
    expect(replaceSkillsSchema.safeParse({ skills: ['x'.repeat(256)] }).success).toBe(false);
  });
});
