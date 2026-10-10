import type { Database } from '../database.js';
import type { Insertable } from 'kysely';
import type { Activities } from '../types.generated.js';
import { newId } from '../ids.js';
import { toJsonColumn } from '../json.js';
import { inTransaction } from '../transaction.js';
import { translationParams } from '../../validation/json-shapes.js';

/**
 * A deterministic, realistic-size dataset for measuring search, browse and the
 * dashboard locally (docs/m6-plan.md §1.1): by default 1,000 users and 3,000
 * projects with English, Russian and Armenian text, a Zipf-like skill
 * distribution that includes `AI`, `ML`, `Go`, `C#`, `UI`, `R`, and summaries
 * that carry the short words and their false-positive bait (`main`, `ago`).
 *
 * Not the demo seed: it does not use fixed ids, so it is for a throwaway
 * database, and the CLI refuses one that already has users.
 */

export interface PerfSeedOptions {
  users?: number;
  projectsPerUser?: number;
}

const EN_FIRST = ['Anna', 'David', 'Levon', 'Sara', 'Michael', 'Emma', 'Arman', 'Lilit', 'Tom'];
const EN_LAST = ['Smith', 'Hakobyan', 'Brown', 'Petrosyan', 'Lee', 'Garcia', 'Khachatryan'];
const RU_FIRST = [
  'Алексей',
  'Елена',
  'Дмитрий',
  'Мария',
  'Иван',
  'Ольга',
  'Пётр',
  'Алёна',
  'Фёдор',
];
const RU_LAST = ['Иванов', 'Петрова', 'Смирнов', 'Кузнецова', 'Попов', 'Соколова', 'Ёлкина'];
const AM_FIRST = ['Արմեն', 'Անի', 'Լևոն', 'Մարի', 'Գոռ', 'Նարե', 'Տիգրան', 'Լիլիթ', 'Վահե'];
const AM_LAST = ['Ասատրյան', 'Հակոբյան', 'Պետրոսյան', 'Գրիգորյան', 'Սարգսյան', 'Մկրտչյան'];
const HEADLINES = [
  'Software developer',
  'Дизайнер интерфейсов',
  'ML engineer',
  'Ծրագրավորող',
  'Data analyst',
  'UI/UX designer',
  'IoT hobbyist',
];
const SKILLS = [
  ...[
    'JavaScript',
    'TypeScript',
    'Python',
    'Java',
    'C++',
    'C#',
    'Go',
    'Rust',
    'React',
    'Node.js',
    'SQL',
    'MySQL',
    'Docker',
    'AI',
    'ML',
    'IoT',
    'UI',
    'UX',
    'R',
    'C',
    'Kotlin',
    'Arduino',
    'Raspberry Pi',
    'MQTT',
    'PyTorch',
    'NLP',
    'Figma',
    'Linux',
    'Գրաֆիկ դիզայն',
    'Машинное обучение',
    'Анализ данных',
  ],
  ...Array.from({ length: 100 }, (_, i) => `Skill${i}`),
];
const PROJECT_TITLES = [
  'Smart Garden IoT System',
  'Paper Summarizer',
  'Portfolio Platform',
  'Chat Application',
  'Умный сад на Arduino',
  'Система учёта студентов',
  'Ёлочная гирлянда на ESP32',
  'Խելացի այգի',
  'Ուսանողական պլատֆորմ',
];
const SUMMARIES = [
  'An app that helps students organise work and share results.',
  'Система автоматизирует рутинные задачи и показывает результаты на панели.',
  'Հավելվածը օգնում է ուսանողներին կազմակերպել աշխատանքը։',
  'A research prototype using machine learning for classification, with IoT sensors.',
  'Built with AI assistance.',
  'Backend written in Go and C#.',
  'Maintains the main email chain; an algorithm from long ago.',
  'Использует ИИ и нейросети.',
];
const TAGS = ['web', 'mobile', 'ai', 'iot', 'game', 'research', 'open-source', 'design', 'data'];
const CATEGORIES = ['academic', 'personal', 'research', 'hackathon', 'course', 'other'] as const;
const INSTITUTIONS = ['NPUA', 'YSU', 'AUA', 'Polytechnic', 'ՀԱՊՀ', 'Ереванский государственный'];
const FIELDS = [
  'Computer Science',
  'Software Engineering',
  'Design',
  'Информатика',
  'Ծրագրավորում',
];

/** A small linear congruential generator: the same data on every run. */
function prng(seed = 12345) {
  let s = seed;
  const next = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(next() * a.length)]!;
  const zipf = <T>(a: readonly T[]): T =>
    a[Math.min(a.length - 1, Math.floor(a.length * next() ** 2.2))]!;
  return { next, pick, zipf };
}

async function insertChunks<T extends object>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
}

/** Activities per user, as the plan's workload says (5,000 for 1,000 users). */
const ACTIVITIES_PER_USER = 5;

/**
 * A database name this seed must never write to: the integration suite's
 * (`*_test`, which every test file resets) and anything that says it is
 * production. Pure, so the CLI and a unit test share it.
 */
export function perfSeedRefusal(databaseUrl: string): string | undefined {
  let name: string;
  try {
    name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    return 'DATABASE_URL is not a URL';
  }
  if (name === '') return 'DATABASE_URL names no database';
  if (/(^|[_-])test($|[_-])/i.test(name)) {
    return `refusing to seed ${name}: it looks like the integration test database`;
  }
  if (/prod/i.test(name)) return `refusing to seed ${name}: it looks like production`;
  return undefined;
}

/**
 * One transaction: a failure part-way leaves the database as it was, so a
 * retry starts clean instead of tripping over half a dataset.
 */
export function perfSeed(
  db: Database,
  options: PerfSeedOptions = {},
): Promise<{ users: number; projects: number }> {
  return inTransaction(db, (trx) => load(trx, options));
}

async function load(
  db: Database,
  { users = 1000, projectsPerUser = 3 }: PerfSeedOptions,
): Promise<{ users: number; projects: number }> {
  const { next, pick, zipf } = prng();
  const now = Date.now();
  const u: {
    id: string;
    auth0Id: string;
    name: string;
    headline: string;
    location: string;
    isPublic: boolean;
    createdAt: Date;
  }[] = [];
  const edu: {
    id: string;
    userId: string;
    institution: string;
    degree: string;
    field: string;
    startYear: number;
    endYear: number;
  }[] = [];
  const skills: { id: string; userId: string; skillName: string; sortOrder: number }[] = [];
  const terms = new Set<string>();
  const proj: {
    id: string;
    userId: string;
    title: string;
    summary: string;
    category: (typeof CATEGORIES)[number];
    isPublic: boolean;
    isDraft: boolean;
    createdAt: Date;
    updatedAt: Date;
  }[] = [];
  const tech: { projectId: string; name: string; sortOrder: number }[] = [];
  const tags: { projectId: string; name: string; sortOrder: number }[] = [];
  const members: { id: string; projectId: string; userId: string; name: string }[] = [];
  const feed: Insertable<Activities>[] = [];

  for (let i = 0; i < users; i++) {
    const id = newId();
    const lang = i % 3;
    const name =
      lang === 0
        ? `${pick(EN_FIRST)} ${pick(EN_LAST)}`
        : lang === 1
          ? `${pick(RU_FIRST)} ${pick(RU_LAST)}`
          : `${pick(AM_FIRST)} ${pick(AM_LAST)}`;
    const created = new Date(now - next() * 400 * 86_400_000);
    u.push({
      id,
      auth0Id: `auth0|perf${i}`,
      name,
      headline: pick(HEADLINES),
      location: 'Yerevan',
      isPublic: next() < 0.9,
      createdAt: created,
    });
    edu.push({
      id: newId(),
      userId: id,
      institution: pick(INSTITUTIONS),
      degree: 'B.Sc.',
      field: pick(FIELDS),
      startYear: 2018 + Math.floor(next() * 4),
      endYear: 2022 + Math.floor(next() * 6),
    });
    const mine = new Set<string>();
    for (let k = 0; k < 3 + Math.floor(next() * 6); k++) mine.add(zipf(SKILLS));
    let order = 0;
    for (const skillName of mine) {
      skills.push({ id: newId(), userId: id, skillName, sortOrder: order++ });
      terms.add(skillName);
    }
    const own: { id: string; title: string }[] = [];
    for (let j = 0; j < projectsPerUser; j++) {
      const pid = newId();
      const at = new Date(created.getTime() + next() * 200 * 86_400_000);
      proj.push({
        id: pid,
        userId: id,
        title: `${pick(PROJECT_TITLES)} ${Math.floor(next() * 1000)}`,
        summary: `${pick(SUMMARIES)} ${pick(SUMMARIES)}`,
        category: pick(CATEGORIES),
        isPublic: next() < 0.85,
        isDraft: next() < 0.08,
        createdAt: at,
        updatedAt: at,
      });
      const used = new Set<string>();
      for (let k = 0; k < 2 + Math.floor(next() * 4); k++) used.add(zipf(SKILLS));
      let o = 0;
      for (const name of used) {
        tech.push({ projectId: pid, name, sortOrder: o++ });
        terms.add(name);
      }
      const t = new Set<string>();
      for (let k = 0; k < 1 + Math.floor(next() * 3); k++) t.add(pick(TAGS));
      o = 0;
      for (const name of t) {
        tags.push({ projectId: pid, name, sortOrder: o++ });
        terms.add(name);
      }
      own.push({ id: pid, title: proj.at(-1)!.title });
      // A team member is someone else: the owner is implicit (docs/m5-plan.md §2.2).
      // `u` ends with the current owner, so the others are all but the last.
      if (u.length > 1 && next() < 0.3) {
        const other = u[Math.floor(next() * (u.length - 1))]!;
        members.push({ id: newId(), projectId: pid, userId: other.id, name: 'Member' });
      }
    }
    // Activities the application could have written: its registry's keys and shapes.
    const skillNames = [...mine];
    for (let k = 0; k < ACTIVITIES_PER_USER; k++) {
      const timestamp = new Date(now - next() * 90 * 86_400_000);
      const project = own[k % own.length];
      if (project !== undefined && k % 2 === 0) {
        feed.push({
          id: newId(),
          userId: id,
          type: 'project',
          translationKey: 'projectCreated',
          translationParams: toJsonColumn(translationParams, {
            projectId: project.id,
            projectName: project.title,
          }),
          timestamp,
        });
      } else {
        feed.push({
          id: newId(),
          userId: id,
          type: 'profile',
          translationKey: 'newSkill',
          translationParams: toJsonColumn(translationParams, {
            skillName: skillNames[k % skillNames.length] ?? 'AI',
          }),
          timestamp,
        });
      }
    }
  }

  await insertChunks(u, (c) => db.insertInto('users').values(c).execute());
  await insertChunks(edu, (c) => db.insertInto('education').values(c).execute());
  await insertChunks(
    [...terms].map((name) => ({ name })),
    (c) =>
      db
        .insertInto('terms')
        .values(c)
        .onDuplicateKeyUpdate((eb) => ({ name: eb.ref('terms.name') }))
        .execute(),
  );
  await insertChunks(skills, (c) =>
    db
      .insertInto('userSkills')
      .values(c)
      .onDuplicateKeyUpdate((eb) => ({ id: eb.ref('userSkills.id') }))
      .execute(),
  );
  await insertChunks(proj, (c) => db.insertInto('projects').values(c).execute());
  await insertChunks(tech, (c) =>
    db
      .insertInto('projectTechnologies')
      .values(c)
      .onDuplicateKeyUpdate((eb) => ({ name: eb.ref('projectTechnologies.name') }))
      .execute(),
  );
  await insertChunks(tags, (c) =>
    db
      .insertInto('projectTags')
      .values(c)
      .onDuplicateKeyUpdate((eb) => ({ name: eb.ref('projectTags.name') }))
      .execute(),
  );
  await insertChunks(members, (c) =>
    db
      .insertInto('projectTeamMembers')
      .values(c.map((m) => ({ ...m, status: 'accepted' as const })))
      .onDuplicateKeyUpdate((eb) => ({ id: eb.ref('projectTeamMembers.id') }))
      .execute(),
  );
  await insertChunks(feed, (c) => db.insertInto('activities').values(c).execute());
  return { users: u.length, projects: proj.length };
}
