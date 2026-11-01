import { csvRecords } from './csv-records.js';
import { SPECS, type Dataset, type DatasetSpec } from './datasets.js';
import { parseLinkedinDate, toYearMonth, type ParsedDate } from './dates.js';
import { LinkedinParseError } from './errors.js';

/**
 * One LinkedIn export CSV into proposed profile entries. Pure: a byte stream in, a
 * result out. Nothing here validates against the profile schemas (the preview does) or
 * touches storage. A cell is read only if its column is in the dataset's `mapped` list.
 */

export interface Problem {
  field: string;
  code: 'REQUIRED' | 'DATE_UNPARSED' | 'DATE_NEEDS_MONTH' | 'END_BEFORE_START';
}

export interface ParsedItem<F> {
  fields: F;
  problems: Problem[];
}

export interface ExperienceFields {
  title: string;
  organization: string;
  start: string | null;
  end: string | null;
  summary: string;
  achievements: string[];
  skills: string[];
}
export interface EducationFields {
  institution: string;
  degree: string;
  /** Not in the export: always empty, with a REQUIRED problem, for the student to fill. */
  field: string;
  startYear: number | null;
  endYear: number | null;
  description: string | null;
  highlights: string[];
}
export interface CertificationFields {
  name: string;
  issuer: string;
  date: string | null;
  credentialUrl: string | null;
}
export interface ProfileFields {
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  summary: string | null;
  industry: string | null;
  location: string | null;
  websites: string | null;
}

export interface ItemsByDataset {
  positions: ParsedItem<ExperienceFields>;
  education: ParsedItem<EducationFields>;
  skills: ParsedItem<{ name: string }>;
  certifications: ParsedItem<CertificationFields>;
  profile: ParsedItem<ProfileFields>;
}

export type DatasetOutcome<D extends Dataset> =
  /** The file has the dataset's header; `skippedColumns` are names only, never values. */
  | { status: 'ok'; items: ItemsByDataset[D][]; skippedColumns: string[]; rows: number }
  /** No header row with any known column: another interface language, or not this file. */
  | { status: 'unrecognised_language' }
  /** Known header, but a column the dataset cannot do without is absent. */
  | { status: 'columns_missing'; missing: string[] }
  /** No records at all. */
  | { status: 'empty' };

export interface ParseOptions {
  /** Longest record, in bytes. A longer one is `RECORD_TOO_LARGE`. */
  maxRecordBytes?: number;
  /** Most data rows. More is `TOO_MANY_ROWS`. */
  maxRows?: number;
}

export const DEFAULT_MAX_RECORD_BYTES = 65_536;
export const DEFAULT_MAX_ROWS = 2_000;
/** Records scanned for the header row, so a notes preamble does not hide it. */
const HEADER_SCAN_RECORDS = 6;
const MAX_REPORTED_COLUMNS = 50;
const MAX_COLUMN_NAME = 100;

export async function parseLinkedinDataset<D extends Dataset>(
  dataset: D,
  input: AsyncIterable<Uint8Array | string>,
  options: ParseOptions = {},
): Promise<DatasetOutcome<D>> {
  const spec = SPECS[dataset];
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const records = csvRecords(input, options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES);

  let columns: Columns | null = null;
  let scanned = 0;
  let sawRecord = false;
  const items: ItemsByDataset[D][] = [];
  let rows = 0;

  for await (const record of records) {
    sawRecord = true;
    if (columns === null) {
      scanned += 1;
      const header = readHeader(spec, record);
      columns = header;
      if (header === null) {
        if (scanned >= HEADER_SCAN_RECORDS) return { status: 'unrecognised_language' };
        continue;
      }
      const missing = spec.required.filter((c) => !header.index.has(c));
      if (missing.length > 0) return { status: 'columns_missing', missing };
      continue;
    }
    const cells = pick(columns, record);
    if (cells === null) continue;
    rows += 1;
    if (rows > maxRows) throw new LinkedinParseError('TOO_MANY_ROWS');
    const item = BUILDERS[dataset](cells);
    if (item !== null) items.push(item);
  }

  if (!sawRecord) return { status: 'empty' };
  if (columns === null) return { status: 'unrecognised_language' };
  return { status: 'ok', items: finish(dataset, items), skippedColumns: columns.skipped, rows };
}

/** One profile row is read; skills are one case-insensitive namespace, first spelling wins. */
function finish<D extends Dataset>(dataset: D, items: ItemsByDataset[D][]): ItemsByDataset[D][] {
  if (dataset === 'profile') return items.slice(0, 1);
  if (dataset !== 'skills') return items;
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = (item as ItemsByDataset['skills']).fields.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface Columns {
  /** Mapped column name -> its position in the record. */
  index: Map<string, number>;
  skipped: string[];
}

function readHeader(spec: DatasetSpec, record: string[]): Columns | null {
  const known = new Set([...Object.keys(spec.mapped), ...spec.ignored, ...spec.required]);
  const names = record.map((c) => c.trim());
  if (!names.some((n) => known.has(n))) return null;

  const index = new Map<string, number>();
  const skipped: string[] = [];
  names.forEach((name, i) => {
    if (name === '' || spec.ignored.includes(name)) return;
    if (Object.hasOwn(spec.mapped, name) && !index.has(name)) {
      index.set(name, i);
      return;
    }
    // Unknown, or a duplicate of a mapped column: reported by name, never read.
    if (skipped.length < MAX_REPORTED_COLUMNS && !skipped.includes(name)) {
      skipped.push(name.slice(0, MAX_COLUMN_NAME));
    }
  });
  return { index, skipped };
}

/** The mapped cells of a row, by field name; null for a row with nothing in it. */
function pick(columns: Columns, record: string[]): Record<string, string> | null {
  const spec = [...columns.index.entries()];
  const cells: Record<string, string> = {};
  let any = false;
  for (const [name, i] of spec) {
    const value = (record[i] ?? '').trim();
    cells[name] = value;
    if (value !== '') any = true;
  }
  return any ? cells : null;
}

const cell = (cells: Record<string, string>, name: string): string => cells[name] ?? '';
const orNull = (v: string): string | null => (v === '' ? null : v);

function required(problems: Problem[], field: string, value: string): string {
  if (value === '') problems.push({ field, code: 'REQUIRED' });
  return value;
}

/** A date as `YYYY-MM`, or null with the problem that says why. */
function monthOf(
  problems: Problem[],
  field: string,
  raw: string,
  mandatory: boolean,
): string | null {
  const d: ParsedDate = parseLinkedinDate(raw);
  switch (d.kind) {
    case 'empty':
      if (mandatory) problems.push({ field, code: 'REQUIRED' });
      return null;
    case 'month':
      return toYearMonth(d);
    case 'year':
      problems.push({ field, code: 'DATE_NEEDS_MONTH' });
      return null;
    case 'unparsed':
      problems.push({ field, code: 'DATE_UNPARSED' });
      return null;
  }
}

function yearOf(
  problems: Problem[],
  field: string,
  raw: string,
  mandatory: boolean,
): number | null {
  const d = parseLinkedinDate(raw);
  if (d.kind === 'year' || d.kind === 'month') return d.year;
  if (d.kind === 'unparsed') problems.push({ field, code: 'DATE_UNPARSED' });
  else if (mandatory) problems.push({ field, code: 'REQUIRED' });
  return null;
}

const BUILDERS: { [D in Dataset]: (c: Record<string, string>) => ItemsByDataset[D] | null } = {
  positions(c) {
    const problems: Problem[] = [];
    const start = monthOf(problems, 'start', cell(c, 'Started On'), true);
    const end = monthOf(problems, 'end', cell(c, 'Finished On'), false);
    if (start !== null && end !== null && end < start) {
      problems.push({ field: 'end', code: 'END_BEFORE_START' });
    }
    return {
      fields: {
        title: required(problems, 'title', cell(c, 'Title')),
        organization: required(problems, 'organization', cell(c, 'Company Name')),
        start,
        end,
        summary: cell(c, 'Description'),
        achievements: [],
        skills: [],
      },
      problems,
    };
  },
  education(c) {
    const problems: Problem[] = [];
    const startYear = yearOf(problems, 'startYear', cell(c, 'Start Date'), true);
    const endYear = yearOf(problems, 'endYear', cell(c, 'End Date'), false);
    if (startYear !== null && endYear !== null && endYear < startYear) {
      problems.push({ field: 'endYear', code: 'END_BEFORE_START' });
    }
    const degree = required(problems, 'degree', cell(c, 'Degree Name'));
    problems.push({ field: 'field', code: 'REQUIRED' });
    return {
      fields: {
        institution: required(problems, 'institution', cell(c, 'School Name')),
        degree,
        field: '',
        startYear,
        endYear,
        description: orNull(cell(c, 'Notes')),
        highlights: [],
      },
      problems,
    };
  },
  skills(c) {
    const name = cell(c, 'Name');
    return name === '' ? null : { fields: { name }, problems: [] };
  },
  certifications(c) {
    const problems: Problem[] = [];
    const date = monthOf(problems, 'date', cell(c, 'Started On'), true);
    return {
      fields: {
        name: required(problems, 'name', cell(c, 'Name')),
        issuer: required(problems, 'issuer', cell(c, 'Authority')),
        date,
        credentialUrl: orNull(cell(c, 'Url')),
      },
      problems,
    };
  },
  profile(c) {
    return {
      fields: {
        firstName: orNull(cell(c, 'First Name')),
        lastName: orNull(cell(c, 'Last Name')),
        headline: orNull(cell(c, 'Headline')),
        summary: orNull(cell(c, 'Summary')),
        industry: orNull(cell(c, 'Industry')),
        location: orNull(cell(c, 'Geo Location')),
        websites: orNull(cell(c, 'Websites')),
      },
      problems: [],
    };
  },
};
