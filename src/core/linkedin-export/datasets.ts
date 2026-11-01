/**
 * The LinkedIn data-export files Gradfolio reads, and their columns.
 *
 * English headers CONFIRMED on a real export (docs/modules/m7/linkedin-export-guide.md,
 * 2026-11-01). Other interface languages (ru, am) are NOT confirmed: a file whose header
 * row matches none of these is reported as an unrecognised export language, never guessed.
 * Columns are matched by exact name (trimmed), never by position.
 *
 * Every other file in the archive (messages, connections, jobs, registration, ...) is
 * never opened. `Profile.csv` also holds a birth date, address, zip code, maiden name and
 * instant messengers: those columns are not listed here, so they are never copied out of
 * a row (they are reported by name as skipped, nothing more).
 */

export const DATASETS = ['positions', 'education', 'skills', 'certifications', 'profile'] as const;
export type Dataset = (typeof DATASETS)[number];

export interface DatasetSpec {
  readonly file: string;
  /** Column name -> the field it fills. These are the only cells ever read. */
  readonly mapped: Readonly<Record<string, string>>;
  /** Known columns Gradfolio has no field for; skipped without being reported. */
  readonly ignored: readonly string[];
  /** Columns without which the file is useless. */
  readonly required: readonly string[];
}

export const SPECS: Readonly<Record<Dataset, DatasetSpec>> = {
  positions: {
    file: 'Positions.csv',
    mapped: {
      'Company Name': 'organization',
      Title: 'title',
      Description: 'summary',
      'Started On': 'start',
      'Finished On': 'end',
    },
    ignored: ['Location'],
    required: ['Company Name', 'Title', 'Started On'],
  },
  education: {
    file: 'Education.csv',
    mapped: {
      'School Name': 'institution',
      'Degree Name': 'degree',
      'Start Date': 'startYear',
      'End Date': 'endYear',
      Notes: 'description',
    },
    ignored: ['Activities'],
    required: ['School Name', 'Start Date'],
  },
  skills: {
    file: 'Skills.csv',
    mapped: { Name: 'name' },
    ignored: [],
    required: ['Name'],
  },
  certifications: {
    file: 'Certifications.csv',
    mapped: {
      Name: 'name',
      Authority: 'issuer',
      Url: 'credentialUrl',
      'Started On': 'date',
    },
    ignored: ['Finished On', 'License Number'],
    required: ['Name', 'Authority'],
  },
  profile: {
    file: 'Profile.csv',
    mapped: {
      'First Name': 'firstName',
      'Last Name': 'lastName',
      Headline: 'headline',
      Summary: 'summary',
      Industry: 'industry',
      'Geo Location': 'location',
      Websites: 'websites',
    },
    ignored: [],
    required: ['First Name', 'Last Name'],
  },
};

/** The dataset an archive entry belongs to, by exact base name; anything else is null. */
export function datasetOfEntry(entryName: string): Dataset | null {
  const base = entryName.slice(entryName.lastIndexOf('/') + 1);
  // A file in a subfolder (Jobs/Profile.csv) is a different file, never a dataset.
  if (base !== entryName) return null;
  for (const d of DATASETS) if (SPECS[d].file === base) return d;
  return null;
}

/**
 * An entry that carries a dataset's base name but not as a top-level `.csv`
 * (`Positions.xlsx`, `Jobs/Positions.csv`): the upload guard refuses the first.
 */
export function datasetByStem(entryName: string): Dataset | null {
  const base = entryName.slice(entryName.lastIndexOf('/') + 1);
  const stem = base.replace(/\.[^.]*$/, '');
  for (const d of DATASETS) if (SPECS[d].file.replace(/\.csv$/, '') === stem) return d;
  return null;
}
