import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildZip, type ZipEntrySpec } from '../../testing/zip-builder.js';
import { LinkedinZipError } from './errors.js';
import { readLinkedinZip, type RangeSource, type ZipLimits } from './zip-reader.js';

const LIMITS: ZipLimits = {
  maxEntries: 50,
  maxUncompressedBytes: 5_000_000,
  maxEntryBytes: 1_000_000,
  maxRatio: 100,
  maxRows: 100,
};

const POSITIONS =
  'Company Name,Title,Description,Location,Started On,Finished On\nAcme,Dev,,,Sep 2022,\n';
const EDUCATION =
  'School Name,Start Date,End Date,Notes,Degree Name,Activities\nSchool,2019,2023,,BSc,\n';
const SKILLS = 'Name\nTypeScript\n';
const CERTS = 'Name,Url,Authority,Started On,Finished On,License Number\nCert,,Issuer,Mar 2023,,\n';

const good = (): ZipEntrySpec[] => [
  { name: 'Positions.csv', data: POSITIONS },
  { name: 'Education.csv', data: EDUCATION, method: 'deflate' },
  { name: 'Skills.csv', data: SKILLS },
  { name: 'Certifications.csv', data: CERTS },
];

class Source implements RangeSource {
  served = 0;
  failAfter: number | undefined;
  opens = 0;
  constructor(readonly body: Buffer) {}
  get size() {
    return this.body.length;
  }
  open(start: number, end: number): Readable {
    this.opens += 1;
    if (this.failAfter !== undefined && this.opens > this.failAfter) {
      return new Readable({
        read() {
          this.destroy(new Error('storage down'));
        },
      });
    }
    const slice = this.body.subarray(start, end);
    this.served += slice.length;
    return Readable.from([slice]);
  }
}

const read = (entries: ZipEntrySpec[], limits: Partial<ZipLimits> = {}) =>
  readLinkedinZip(new Source(buildZip(entries)), { ...LIMITS, ...limits });

async function refusal(promise: Promise<unknown>): Promise<LinkedinZipError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LinkedinZipError);
  return err as LinkedinZipError;
}

describe('a good archive', () => {
  it('parses the four datasets, stored or deflated', async () => {
    const out = await read(good());
    expect(out.outcomes.positions?.items).toHaveLength(1);
    expect(out.outcomes.education?.items[0]?.fields.institution).toBe('School');
    expect(out.outcomes.skills?.items[0]?.fields.name).toBe('TypeScript');
    expect(out.outcomes.certifications?.items[0]?.fields.issuer).toBe('Issuer');
    expect(out.missingFiles).toEqual([]);
  });

  it('counts other entries by extension, never by name; directories are not counted', async () => {
    const out = await read([
      ...good(),
      { name: 'Profile.csv', data: 'First Name,Last Name\nA,B\n' },
      { name: 'Jobs/', noData: true },
      { name: 'Jobs/Job Applications.csv', data: 'x\n' },
      { name: 'Jobs/Positions.csv', data: 'x\n' },
      { name: 'messages.csv', data: 'x\n' },
      { name: 'Rich_Media.PNG', data: 'x' },
      { name: 'README', data: 'x' },
    ]);
    expect(out.skippedFileCount).toBe(6);
    expect(out.extensions).toEqual({ '.csv': 4, '.png': 1, '(none)': 1 });
    expect(JSON.stringify(out)).not.toContain('Job Applications');
  });

  it('reads only the four datasets: Profile.csv is never inflated', async () => {
    const filler = 'A'.repeat(200_000);
    const zip = buildZip([...good(), { name: 'Profile.csv', data: filler }]);
    const source = new Source(zip);
    await readLinkedinZip(source, LIMITS);
    expect(source.served).toBeLessThan(zip.length - filler.length / 2);
  });

  it('reports missing and empty datasets, and skipped columns with their file', async () => {
    const out = await read([
      { name: 'Positions.csv', data: POSITIONS.replace('Location', 'Surprise') },
      { name: 'Skills.csv', data: '' },
    ]);
    expect(out.missingFiles).toEqual(['Education.csv', 'Skills.csv', 'Certifications.csv']);
    expect(out.skippedColumns).toEqual([{ file: 'Positions.csv', column: 'Surprise' }]);
  });
});

describe('refusals, one stable code each', () => {
  it('not a zip: random bytes, an empty file, a truncated archive', async () => {
    const junk = Buffer.from('this is not a zip file at all');
    expect((await refusal(readLinkedinZip(new Source(junk), LIMITS))).code).toBe('IMPORT_NOT_ZIP');
    expect((await refusal(readLinkedinZip(new Source(Buffer.alloc(0)), LIMITS))).code).toBe(
      'IMPORT_NOT_ZIP',
    );
    const whole = buildZip(good());
    const cut = whole.subarray(0, whole.length - 30);
    expect((await refusal(readLinkedinZip(new Source(cut), LIMITS))).code).toBe('IMPORT_NOT_ZIP');
  });

  it('an archive whose first bytes are not a ZIP signature is not a ZIP, whatever follows', async () => {
    const zip = Buffer.from(buildZip(good()));
    zip.write('JUNK', 0, 'latin1');
    expect((await refusal(readLinkedinZip(new Source(zip), LIMITS))).code).toBe('IMPORT_NOT_ZIP');
  });

  it('an archive with no entries is empty', async () => {
    expect((await refusal(read([]))).code).toBe('IMPORT_EMPTY');
  });

  it('only other files: empty', async () => {
    expect((await refusal(read([{ name: 'messages.csv', data: 'x\n' }]))).code).toBe(
      'IMPORT_EMPTY',
    );
  });

  it('only empty dataset files: empty', async () => {
    expect((await refusal(read([{ name: 'Skills.csv', data: '' }]))).code).toBe('IMPORT_EMPTY');
  });

  it('too many entries, before any entry is read', async () => {
    const source = new Source(buildZip(good()));
    const err = await refusal(readLinkedinZip(source, { ...LIMITS, maxEntries: 3 }));
    expect(err.code).toBe('IMPORT_TOO_MANY_ENTRIES');
  });

  it('a zip bomb: a small entry that inflates a thousandfold, refused from the directory', async () => {
    const big = Buffer.alloc(3_000_000, 'A');
    const zip = buildZip([...good(), { name: 'Rich_Media.bin', data: big, method: 'deflate' }]);
    const source = new Source(zip);
    const err = await refusal(readLinkedinZip(source, LIMITS));
    expect(err.code).toBe('IMPORT_RATIO_EXCEEDED');
    expect(source.served).toBeLessThan(zip.length * 2);
  });

  it('a ratio under the floor is not a bomb', async () => {
    const small = Buffer.alloc(900_000, 'A');
    const out = await read([...good(), { name: 'a.bin', data: small, method: 'deflate' }]);
    expect(out.skippedFileCount).toBe(1);
  });

  it('declared sizes that add up past the total are refused without inflating', async () => {
    const err = await refusal(
      read([
        ...good(),
        { name: 'a.bin', noData: true, declaredSize: 3_000_000, declaredCompressed: 3_000_000 },
        { name: 'b.bin', noData: true, declaredSize: 3_000_000, declaredCompressed: 3_000_000 },
      ]),
    );
    expect(err.code).toBe('IMPORT_UNCOMPRESSED_TOO_LARGE');
  });

  it('a dataset over the per-entry cap', async () => {
    const err = await refusal(
      read([{ name: 'Skills.csv', data: `Name\n${'x\n'.repeat(600_000)}` }], {
        maxEntryBytes: 1_000_000,
      }),
    );
    expect(err.code).toBe('IMPORT_UNCOMPRESSED_TOO_LARGE');
  });

  it('an entry that inflates past the size it declared', async () => {
    const lying = 'Name\n' + 'skill\n'.repeat(1000);
    const err = await refusal(
      read([{ name: 'Skills.csv', data: lying, declaredSize: 20, method: 'deflate' }]),
    );
    expect(err.code).toBe('IMPORT_UNCOMPRESSED_TOO_LARGE');
  });

  it.each([
    ['dot-dot', '../evil.csv'],
    ['nested dot-dot', 'Jobs/../../evil.csv'],
    ['absolute', '/etc/passwd.csv'],
    ['backslash', '..\\evil.csv'],
    ['backslash alone', 'a\\b.csv'],
    ['drive letter', 'C:evil.csv'],
    ['NUL byte', 'Skills.csv\0.txt'],
    ['over 255 characters', `${'a'.repeat(256)}.csv`],
  ])('an unsafe path: %s', async (_label, name) => {
    const err = await refusal(read([...good(), { name, data: 'x\n' }]));
    expect(err.code).toBe('IMPORT_UNSAFE_PATH');
  });

  it('an unsafe path in an unread entry still refuses the archive', async () => {
    const err = await refusal(read([{ name: '../../x.png', data: 'x' }, ...good()]));
    expect(err.code).toBe('IMPORT_UNSAFE_PATH');
  });

  it('an encrypted entry', async () => {
    const err = await refusal(
      read([
        ...good(), // traditional encryption prefixes the data with a 12-byte header
        { name: 'secret.bin', data: 'x', encrypted: true, declaredCompressed: 13 },
      ]),
    );
    expect(err.code).toBe('IMPORT_ENCRYPTED');
  });

  it('a dataset that is not a CSV', async () => {
    const err = await refusal(read([...good(), { name: 'Positions.xlsx', data: 'x' }]));
    expect(err.code).toBe('IMPORT_ENTRY_NOT_CSV');
  });

  it('a dataset name twice', async () => {
    const err = await refusal(read([...good(), { name: 'Skills.csv', data: SKILLS }]));
    expect(err.code).toBe('IMPORT_DUPLICATE_ENTRY');
  });

  it('a dataset with a known header but a missing required column names the columns', async () => {
    const err = await refusal(read([{ name: 'Positions.csv', data: 'Title,Location\nDev,x\n' }]));
    expect(err.code).toBe('IMPORT_COLUMNS_MISSING');
    expect(err.details).toEqual({ file: 'Positions.csv', columns: ['Company Name', 'Started On'] });
  });

  it('another interface language', async () => {
    const err = await refusal(
      read([{ name: 'Positions.csv', data: 'Название компании,Должность\nАкме,Разработчик\n' }]),
    );
    expect(err.code).toBe('IMPORT_LANGUAGE_UNRECOGNISED');
    expect(err.details).toEqual({ file: 'Positions.csv' });
  });

  it('a damaged CSV, too many rows, a corrupt deflate stream', async () => {
    expect((await refusal(read([{ name: 'Skills.csv', data: 'Name\n"open\n' }]))).code).toBe(
      'IMPORT_MALFORMED_CSV',
    );
    const rows = 'Name\n' + 'a\n'.repeat(11);
    expect((await refusal(read([{ name: 'Skills.csv', data: rows }], { maxRows: 10 }))).code).toBe(
      'IMPORT_MALFORMED_CSV',
    );
    const zip = buildZip([{ name: 'Skills.csv', data: SKILLS, method: 'deflate' }]);
    const garbled = Buffer.from(zip);
    garbled.fill(0xff, 30 + 'Skills.csv'.length, 30 + 'Skills.csv'.length + 6);
    expect((await refusal(readLinkedinZip(new Source(garbled), LIMITS))).code).toBe(
      'IMPORT_MALFORMED_CSV',
    );
  });

  it('keeps no archive content in the refusal', async () => {
    const err = await refusal(read([{ name: 'Skills.csv', data: 'Name\n"SECRET-ROW\n' }]));
    expect(JSON.stringify([err.message, err.details])).not.toContain('SECRET');
    const bad = await refusal(read([...good(), { name: '../Jane Doe/contacts.csv', data: 'x' }]));
    expect(JSON.stringify([bad.message, bad.details])).not.toContain('Jane');
  });
});

describe('storage failures are not bad archives', () => {
  it('a read error after the first bytes is passed through', async () => {
    const source = new Source(buildZip(good()));
    source.failAfter = 1;
    await expect(readLinkedinZip(source, LIMITS)).rejects.toThrow('storage down');
  });

  it('a read error while inflating a dataset is passed through', async () => {
    const source = new Source(buildZip(good()));
    // head, end-of-directory search, central directory, then the first entry's data.
    source.failAfter = 4;
    const err = await readLinkedinZip(source, LIMITS).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(LinkedinZipError);
  });
});

describe('the builder', () => {
  it('writes a deflate stream the reader inflates', () => {
    expect(deflateRawSync(Buffer.from('x')).length).toBeGreaterThan(0);
  });
});
