import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_LIMITS,
  projectWriteSchemas,
  type ProjectInput,
} from './project-write.dto.js';
import type { SanitizedHtml } from '../../../core/validation/html.js';

const { create, patch } = projectWriteSchemas(DEFAULT_PROJECT_LIMITS);

describe('create', () => {
  it('fills every default', () => {
    expect(create.parse({ title: ' T ' })).toEqual({
      title: 'T',
      summary: null,
      descriptionHtml: null,
      category: 'other',
      status: 'ongoing',
      isPublic: true,
      isDraft: false,
      liveDemoUrl: null,
      repoUrl: null,
      heroImageUrl: null,
      technologies: [],
      tags: [],
      links: [],
      files: [],
      metadata: { startDate: null, endDate: null, course: null, professor: null },
    });
  });

  it('sanitizes the description and turns blank text, or markup that all goes, into null', () => {
    expect(
      create.parse({ title: 't', descriptionHtml: '<p onclick=x>a</p>' }).descriptionHtml,
    ).toBe('<p>a</p>');
    expect(
      create.parse({ title: 't', descriptionHtml: '<script>x</script>' }).descriptionHtml,
    ).toBeNull();
    expect(create.parse({ title: 't', summary: '  ' }).summary).toBeNull();
  });

  it('normalizes terms and drops case-insensitive duplicates', () => {
    expect(create.parse({ title: 't', tags: [' Web   Dev ', 'web dev', 'Go'] }).tags).toEqual([
      'Web Dev',
      'Go',
    ]);
  });

  it.each([
    ['2025-02-30'],
    ['2025-13-45'],
    ['0000-00-00'],
    ['0000-01-01'],
    ['0999-12-31'],
    ['2025-1-5'],
    ['2025-01-15T10:00:00Z'],
    [''],
  ])('refuses the date %j without throwing', (date) => {
    expect(create.safeParse({ title: 't', metadata: { startDate: date } }).success).toBe(false);
  });

  it('accepts the first supported day', () => {
    expect(create.safeParse({ title: 't', metadata: { startDate: '1000-01-01' } }).success).toBe(
      true,
    );
  });

  it('accepts a leap day and refuses a non-leap one', () => {
    expect(create.safeParse({ title: 't', metadata: { startDate: '2024-02-29' } }).success).toBe(
      true,
    );
    expect(create.safeParse({ title: 't', metadata: { startDate: '2025-02-29' } }).success).toBe(
      false,
    );
  });

  it('takes the limits it was built with', () => {
    const tight = projectWriteSchemas({ ...DEFAULT_PROJECT_LIMITS, maxTags: 1 });
    expect(tight.create.safeParse({ title: 't', tags: ['a', 'b'] }).success).toBe(false);
    expect(tight.create.safeParse({ title: 't', tags: ['a'] }).success).toBe(true);
  });
});

describe('patch', () => {
  it('needs at least one field', () => {
    expect(patch.safeParse({}).success).toBe(false);
    expect(patch.safeParse({ title: 'x' }).success).toBe(true);
    expect(patch.safeParse({ metadata: { course: null } }).success).toBe(true);
  });

  it('does not apply create’s defaults', () => {
    expect(patch.parse({ title: 'x' })).toEqual({ title: 'x' });
  });
});

describe('the repository only takes sanitized HTML', () => {
  it('is a type error to pass a plain string where the input wants SanitizedHtml', () => {
    // @ts-expect-error a plain string is not SanitizedHtml: only sanitizeDescription makes one
    const bad: ProjectInput['descriptionHtml'] = '<script>alert(1)</script>';
    const good: ProjectInput['descriptionHtml'] = '<p>x</p>' as SanitizedHtml;
    expect([bad, good]).toHaveLength(2);
  });
});
