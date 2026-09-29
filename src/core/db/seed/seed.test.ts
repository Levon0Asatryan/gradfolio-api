import { describe, expect, it } from 'vitest';
import { columnString, type StringColumn } from '../../validation/columns.js';
import { httpUrl } from '../../validation/http-url.js';
import { termList } from '../../validation/terms.js';
import { yearMonth } from '../../validation/year-month.js';
import { notifications, projects, users } from './data.js';

/** The seed passes the same validators the API applies to user input. */
describe('seed data', () => {
  const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => [
    value,
    schema.safeParse(value).success,
  ];
  const url = httpUrl();

  it('every URL is absolute http(s)', () => {
    const urls = [
      ...users.flatMap((u) => [u.avatarUrl, u.github, u.linkedin, u.website]),
      ...users.flatMap((u) => u.certifications.map((c) => c.credentialUrl)),
      ...projects.flatMap((p) => [p.heroImageUrl, p.liveDemoUrl, p.repoUrl]),
      ...projects.flatMap((p) => [...p.links, ...p.files, ...p.attachments].map((l) => l.url)),
    ].filter((v): v is string => v !== null);
    expect(urls.length).toBeGreaterThan(20);
    for (const u of urls) expect(ok(url, u)).toEqual([u, true]);
  });

  it('every month is YYYY-MM', () => {
    const months = [
      ...users.flatMap((u) => u.experience.flatMap((e) => [e.start, e.end])),
      ...users.flatMap((u) => u.certifications.map((c) => c.date)),
    ].filter((v): v is string => v !== null);
    for (const m of months) expect(ok(yearMonth, m)).toEqual([m, true]);
  });

  it('every string fits its column', () => {
    const checks: [StringColumn, string | null][] = [
      ...users.flatMap((u): [StringColumn, string | null][] => [
        ['users.name', u.name],
        ['users.headline', u.headline],
        ['users.location', u.location],
        ['users.bio', u.bio],
        ['users.email', u.email],
      ]),
      ...users.flatMap((u) =>
        u.education.flatMap((e): [StringColumn, string][] => [
          ['education.institution', e.institution],
          ['education.degree', e.degree],
          ['education.field', e.field],
        ]),
      ),
      ...projects.flatMap((p): [StringColumn, string | null][] => [
        ['projects.title', p.title],
        ['projects.summary', p.summary],
        ['projects.meta_course', p.metaCourse],
        ['projects.meta_professor', p.metaProfessor],
        ['projects.repo_language', p.repoLanguage],
      ]),
    ];
    for (const [column, value] of checks) {
      if (value !== null)
        expect([column, columnString(column).safeParse(value).success]).toEqual([column, true]);
    }
  });

  it('skills, technologies and tags are valid term lists without duplicates', () => {
    const lists = [
      ...users.map((u) => u.skills),
      ...projects.flatMap((p) => [p.technologies, p.tags]),
    ];
    for (const list of lists) expect(termList({ maxItems: 50 }).parse(list)).toEqual(list);
  });

  it('never makes a project owner a team member of their own project (S11)', () => {
    for (const p of projects) expect(p.team.map((m) => m.user)).not.toContain(p.owner);
  });

  it('every notification is about a seeded project its recipient owns or was invited to', () => {
    for (const n of notifications) {
      const project = projects.find((p) => p.id === n.project);
      expect(project).toBeDefined();
      const involved = [project!.owner, ...project!.team.map((m) => m.user)];
      expect(involved).toContain(n.user);
    }
  });

  it('writes in all three UI languages', () => {
    const text = users.map((u) => `${u.name} ${u.headline} ${u.bio}`).join(' ');
    expect(text).toMatch(/[Ա-֏]/); // Armenian
    expect(text).toMatch(/[Ѐ-ӿ]/); // Cyrillic
    expect(text).toMatch(/[A-Za-z]{4,}/); // English
  });
});
