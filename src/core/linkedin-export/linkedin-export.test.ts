import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { datasetByStem, datasetOfEntry, SPECS } from './datasets.js';
import { parseLinkedinDate } from './dates.js';
import { LinkedinParseError } from './errors.js';
import { parseLinkedinDataset } from './parse-dataset.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../testing/fixtures/linkedin/${name}`, import.meta.url));

/** Chunks of 7 bytes, so every record straddles chunk boundaries. */
const stream = (data: Buffer | string): AsyncIterable<Uint8Array> => {
  const buf = Buffer.from(data);
  const chunks: Buffer[] = [];
  for (let i = 0; i < buf.length; i += 7) chunks.push(buf.subarray(i, i + 7));
  return Readable.from(chunks);
};

async function ok<D extends 'positions' | 'education' | 'skills' | 'certifications' | 'profile'>(
  dataset: D,
  data: Buffer | string,
  options?: Parameters<typeof parseLinkedinDataset>[2],
) {
  const out = await parseLinkedinDataset(dataset, stream(data), options);
  if (out.status !== 'ok') throw new Error(`expected ok, got ${out.status}`);
  return out;
}

describe('dates', () => {
  it.each([
    ['Sep 2022', { kind: 'month', year: 2022, month: 9 }],
    ['sep 2022', { kind: 'month', year: 2022, month: 9 }],
    ['2019', { kind: 'year', year: 2019 }],
    ['2019-03', { kind: 'month', year: 2019, month: 3 }],
    ['2019-03-15', { kind: 'month', year: 2019, month: 3 }],
    ['15 Mar 2019', { kind: 'month', year: 2019, month: 3 }],
    ['Mar 15, 2019', { kind: 'month', year: 2019, month: 3 }],
    ['', { kind: 'empty' }],
    ['  ', { kind: 'empty' }],
  ])('parses %j', (raw, expected) => {
    expect(parseLinkedinDate(raw)).toEqual(expected);
  });

  it.each([
    '12/03/2020', // day-first or month-first: not guessed
    'Foo 2020',
    'Sept 2020',
    'September 2020',
    '2020-13',
    '2020-02-30',
    '31 Feb 2020',
    'Mar 32, 2020',
    '1850',
    '2200',
    'Mar 1850',
    'present',
    "Mar '20",
  ])('reports %j as unparsed', (raw) => {
    expect(parseLinkedinDate(raw)).toEqual({ kind: 'unparsed' });
  });

  it('accepts a leap day only in a leap year', () => {
    expect(parseLinkedinDate('2024-02-29').kind).toBe('month');
    expect(parseLinkedinDate('2023-02-29').kind).toBe('unparsed');
  });
});

describe('positions', () => {
  it('maps the real headers; quoted commas, quotes and line breaks survive', async () => {
    const out = await ok('positions', fixture('Positions.csv'));
    expect(out.skippedColumns).toEqual([]);
    expect(out.rows).toBe(5);
    expect(out.items[0]).toEqual({
      fields: {
        title: 'Backend Developer',
        organization: 'Northwind Labs',
        start: '2022-09',
        end: '2024-06',
        summary: 'Built REST services in Node.js.\nWrote the "billing" module, with tests.',
        achievements: [],
        skills: [],
      },
      problems: [],
    });
    expect(out.items[1]?.fields).toMatchObject({ organization: 'Contoso Systems', summary: '' });
  });

  it('a year-only date is a problem, not an invented month', async () => {
    const out = await ok('positions', fixture('Positions.csv'));
    expect(out.items[2]?.fields.start).toBeNull();
    expect(out.items[2]?.problems).toEqual([{ field: 'start', code: 'DATE_NEEDS_MONTH' }]);
  });

  it('an ambiguous date is reported as unparsed, never guessed', async () => {
    const out = await ok('positions', fixture('Positions.csv'));
    expect(out.items[3]?.fields.start).toBeNull();
    expect(out.items[3]?.problems).toEqual([{ field: 'start', code: 'DATE_UNPARSED' }]);
  });

  it('flags an end before the start; an empty end means present', async () => {
    const out = await ok('positions', fixture('Positions.csv'));
    expect(out.items[4]?.problems).toEqual([{ field: 'end', code: 'END_BEFORE_START' }]);
    expect(out.items[2]?.fields.end).toBeNull();
  });

  it('matches columns by name, not position', async () => {
    const out = await ok(
      'positions',
      'Finished On,Started On,Title,Company Name\nJun 2024,Sep 2022,Dev,Acme\n',
    );
    expect(out.items[0]?.fields).toMatchObject({
      title: 'Dev',
      organization: 'Acme',
      start: '2022-09',
      end: '2024-06',
    });
  });

  it('skips an unknown column and reports its name only', async () => {
    const out = await ok(
      'positions',
      'Company Name,Title,Started On,Surprise Column\nAcme,Dev,Sep 2022,SECRET-VALUE\n',
    );
    expect(out.skippedColumns).toEqual(['Surprise Column']);
    expect(JSON.stringify(out)).not.toContain('SECRET-VALUE');
  });

  it('reports a duplicate of a mapped column once, and reads the first', async () => {
    const out = await ok(
      'positions',
      'Company Name,Title,Title,Started On\nAcme,First,Second,Sep 2022\n',
    );
    expect(out.skippedColumns).toEqual(['Title']);
    expect(out.items[0]?.fields.title).toBe('First');
  });

  it('ignores empty header names and short or long rows', async () => {
    const out = await ok(
      'positions',
      'Company Name,Title,,Started On\nAcme,Dev\nAcme2,Dev2,x,Sep 2022,extra,extra\n',
    );
    expect(out.skippedColumns).toEqual([]);
    expect(out.items[0]?.problems).toEqual([{ field: 'start', code: 'REQUIRED' }]);
    expect(out.items[1]?.fields.start).toBe('2022-09');
  });

  it('finds the header row after a notes preamble', async () => {
    const out = await ok(
      'positions',
      'Notes:\n"a note, with a comma"\nCompany Name,Title,Started On\nAcme,Dev,Sep 2022\n',
    );
    expect(out.items).toHaveLength(1);
  });

  it('strips a byte-order mark and reads CRLF', async () => {
    const out = await ok('positions', '﻿Company Name,Title,Started On\r\nAcme,Dev,Sep 2022\r\n');
    expect(out.items[0]?.fields.organization).toBe('Acme');
  });

  it('skips blank rows and rows with nothing in the read columns', async () => {
    const out = await ok(
      'positions',
      'Company Name,Title,Started On,Location\nAcme,Dev,Sep 2022,\n\n,,,Only a location\n',
    );
    expect(out.items).toHaveLength(1);
    expect(out.rows).toBe(1);
  });

  it('flags an empty title and company', async () => {
    const out = await ok('positions', 'Company Name,Title,Started On\n,,Sep 2022\n');
    expect(out.items[0]?.problems).toEqual([
      { field: 'title', code: 'REQUIRED' },
      { field: 'organization', code: 'REQUIRED' },
    ]);
  });
});

describe('education', () => {
  it('maps the real headers; years from months, empty end is present', async () => {
    const out = await ok('education', fixture('Education.csv'));
    expect(out.rows).toBe(3);
    expect(out.items[0]).toEqual({
      fields: {
        institution: 'Example Technical University',
        degree: 'Bachelor of Science',
        field: '',
        startYear: 2019,
        endYear: 2023,
        description: 'Thesis on parsers',
        highlights: [],
      },
      problems: [{ field: 'field', code: 'REQUIRED' }],
    });
    expect(out.items[1]?.fields).toMatchObject({
      startYear: 2023,
      endYear: null,
      description: null,
    });
  });

  it('flags missing degree and start', async () => {
    const out = await ok('education', fixture('Education.csv'));
    expect(out.items[2]?.problems).toEqual([
      { field: 'startYear', code: 'REQUIRED' },
      { field: 'degree', code: 'REQUIRED' },
      { field: 'field', code: 'REQUIRED' },
    ]);
  });

  it('flags an unparsed date and an end before the start', async () => {
    const out = await ok(
      'education',
      'School Name,Start Date,End Date\nA,2020,2019\nB,soon,2020\n',
    );
    expect(out.items[0]?.problems).toContainEqual({ field: 'endYear', code: 'END_BEFORE_START' });
    expect(out.items[1]?.problems).toContainEqual({ field: 'startYear', code: 'DATE_UNPARSED' });
    expect(out.items[1]?.fields.startYear).toBeNull();
  });
});

describe('skills', () => {
  it('reads the single Name column and collapses case-insensitive duplicates', async () => {
    const out = await ok('skills', fixture('Skills.csv'));
    expect(out.items.map((i) => i.fields.name)).toEqual(['TypeScript', 'SQL', 'Public Speaking']);
  });
});

describe('certifications', () => {
  it('maps the real headers, in the real order', async () => {
    const out = await ok('certifications', fixture('Certifications.csv'));
    expect(out.items[0]).toEqual({
      fields: {
        name: 'Cloud Practitioner',
        issuer: 'Example Cloud',
        date: '2023-03',
        credentialUrl: 'https://example.org/cert/1',
      },
      problems: [],
    });
    expect(out.items[1]?.problems).toEqual([{ field: 'date', code: 'DATE_NEEDS_MONTH' }]);
    expect(out.skippedColumns).toEqual([]);
  });
});

describe('profile', () => {
  it('reads only the allowed columns; the sensitive ones never appear in the result', async () => {
    const out = await ok('profile', fixture('Profile.csv'));
    expect(out.items[0]?.fields).toEqual({
      firstName: 'Anna',
      lastName: 'Testova',
      headline: 'Student developer',
      summary: 'I like parsers.',
      industry: 'Software',
      location: 'Faketown, Exampleland',
      websites: '[PERSONAL:https://example.org/anna]',
    });
    const text = JSON.stringify(out);
    for (const secret of ['SENTINEL', 'Nowhere Street', 'Addressburg']) {
      expect(text).not.toContain(secret);
    }
  });

  it('names the sensitive columns as skipped, never reading them', async () => {
    const out = await ok('profile', fixture('Profile.csv'));
    expect(out.skippedColumns).toEqual([
      'Maiden Name',
      'Address',
      'Birth Date',
      'Zip Code',
      'Twitter Handles',
      'Instant Messengers',
    ]);
  });

  it('keeps no sensitive column in the dataset spec', () => {
    const listed = Object.keys(SPECS.profile.mapped).concat(SPECS.profile.ignored);
    for (const sensitive of [
      'Birth Date',
      'Address',
      'Zip Code',
      'Maiden Name',
      'Instant Messengers',
    ]) {
      expect(listed).not.toContain(sensitive);
    }
  });

  it('reads only the first profile row', async () => {
    const out = await ok('profile', 'First Name,Last Name\nA,B\nC,D\n');
    expect(out.items).toHaveLength(1);
  });
});

describe('language and structure', () => {
  const ruPositions =
    'Название компании,Должность,Описание,Местоположение,Дата начала,Дата окончания\nАкме,Разработчик,,,Сен 2022,\n';
  const amPositions = 'Ընկերություն,Պաշտոն,Սկիզբ\nԱկմե,Ծրագրավորող,2022\n';

  it.each([
    ['ru', ruPositions],
    ['am', amPositions],
  ])('another header set (%s) is an unrecognised language, not a guess', async (_l, data) => {
    expect(await parseLinkedinDataset('positions', stream(data))).toEqual({
      status: 'unrecognised_language',
    });
  });

  it('is unrecognised when the header never appears in the first records', async () => {
    const data = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n') + '\n';
    expect(await parseLinkedinDataset('skills', stream(data))).toEqual({
      status: 'unrecognised_language',
    });
  });

  it('a known header without a required column lists the missing ones', async () => {
    expect(await parseLinkedinDataset('positions', stream('Title,Location\nDev,Home\n'))).toEqual({
      status: 'columns_missing',
      missing: ['Company Name', 'Started On'],
    });
  });

  it('a header-only file is ok with no items; an empty file is empty', async () => {
    expect(await ok('skills', 'Name\n')).toMatchObject({ items: [], rows: 0 });
    expect(await parseLinkedinDataset('skills', stream(''))).toEqual({ status: 'empty' });
  });

  it('refuses a damaged file with a code that carries no content', async () => {
    const err = await parseLinkedinDataset('skills', stream('Name\n"SECRET-ROW\n')).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LinkedinParseError);
    expect((err as LinkedinParseError).code).toBe('MALFORMED_CSV');
    expect((err as Error).message).not.toContain('SECRET');
  });

  it('refuses a stray quote', async () => {
    await expect(parseLinkedinDataset('skills', stream('Name\n"a"b\n'))).rejects.toMatchObject({
      code: 'MALFORMED_CSV',
    });
  });

  it('refuses a record over the byte cap', async () => {
    await expect(
      parseLinkedinDataset('skills', stream(`Name\n${'x'.repeat(200)}\n`), { maxRecordBytes: 100 }),
    ).rejects.toMatchObject({ code: 'RECORD_TOO_LARGE' });
  });

  it('refuses more rows than the cap', async () => {
    const data = 'Name\n' + Array.from({ length: 6 }, (_, i) => `s${i}`).join('\n') + '\n';
    await expect(
      parseLinkedinDataset('skills', stream(data), { maxRows: 5 }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ROWS' });
    expect(await ok('skills', data, { maxRows: 6 })).toMatchObject({ rows: 6 });
  });

  it('passes an input stream failure through unchanged', async () => {
    function* chunks() {
      yield Buffer.from('Name\nA\n');
      throw new Error('upstream gone');
    }
    const broken = () => Readable.from(chunks());
    await expect(parseLinkedinDataset('skills', broken())).rejects.toThrow('upstream gone');
  });

  it('does not read past a refusal', async () => {
    let pulled = 0;
    function* chunks() {
      yield Buffer.from('Name\n');
      for (;;) {
        pulled += 1;
        yield Buffer.from('skill\n');
        if (pulled > 100_000) return;
      }
    }
    const endless = () => Readable.from(chunks());
    await expect(parseLinkedinDataset('skills', endless(), { maxRows: 10 })).rejects.toMatchObject({
      code: 'TOO_MANY_ROWS',
    });
    expect(pulled).toBeLessThan(100_000);
  });

  it('reports at most 50 skipped columns, each name cut to 100 characters', async () => {
    const extra = Array.from({ length: 60 }, (_, i) => `c${i}${'x'.repeat(120)}`);
    const out = await ok('skills', `Name,${extra.join(',')}\nA\n`);
    expect(out.skippedColumns).toHaveLength(50);
    expect(out.skippedColumns[0]).toHaveLength(100);
  });
});

describe('entries', () => {
  it('names a dataset only by its exact top-level file name', () => {
    expect(datasetOfEntry('Positions.csv')).toBe('positions');
    expect(datasetOfEntry('Profile.csv')).toBe('profile');
    expect(datasetOfEntry('Jobs/Positions.csv')).toBeNull();
    expect(datasetOfEntry('positions.csv')).toBeNull();
    expect(datasetOfEntry('Positions.csv.exe')).toBeNull();
    expect(datasetOfEntry('Registration.csv')).toBeNull();
  });

  it('finds a dataset name under another extension', () => {
    expect(datasetByStem('Positions.xlsx')).toBe('positions');
    expect(datasetByStem('Jobs/Skills.json')).toBe('skills');
    expect(datasetByStem('Messages.csv')).toBeNull();
  });
});
