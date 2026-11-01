import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import { datasetByStem, datasetOfEntry, SPECS, type Dataset } from './datasets.js';
import { LinkedinParseError, LinkedinZipError } from './errors.js';
import { parseLinkedinDataset, type DatasetOutcome } from './parse-dataset.js';

/**
 * Reads the four datasets out of a LinkedIn export ZIP without extracting it. The central
 * directory is read first (a few ranged reads) and every guard runs on what it declares
 * before any byte is inflated; then only the dataset entries are inflated, as streams,
 * into the CSV parser. No file is written, no entry is buffered.
 *
 * Profile.csv is deliberately not opened: the preview does not use it, and it holds a birth
 * date and an address.
 */

export interface RangeSource {
  size: number;
  /** Bytes `start` (inclusive) to `end` (exclusive). */
  open(start: number, end: number): Readable;
}

export interface ZipLimits {
  maxEntries: number;
  /** Sum of the declared uncompressed sizes of all entries. */
  maxUncompressedBytes: number;
  /** One parsed entry's declared size; the actual size is held to it by yauzl. */
  maxEntryBytes: number;
  /** Declared uncompressed / compressed, for an entry of at least `RATIO_FLOOR_BYTES`. */
  maxRatio: number;
  maxRows: number;
  maxRecordBytes?: number;
}

export const RATIO_FLOOR_BYTES = 1_000_000;
const MAX_NAME_CHARS = 255;

/** The four datasets the preview reads. */
export const PREVIEW_DATASETS = ['positions', 'education', 'skills', 'certifications'] as const;
export type PreviewDataset = (typeof PREVIEW_DATASETS)[number];

export interface ZipReadResult {
  outcomes: { [D in PreviewDataset]?: Extract<DatasetOutcome<D>, { status: 'ok' }> };
  skippedColumns: { file: string; column: string }[];
  /** Dataset file names that are absent or hold no records. */
  missingFiles: string[];
  /** Entries other than the datasets read (directories not counted). */
  skippedFileCount: number;
  /** Other entries by extension; never their names. */
  extensions: Record<string, number>;
}

/** The ZIP local-header and end-of-directory signatures (`PK\x03\x04`, `PK\x05\x06`). */
export function looksLikeZip(head: Buffer): boolean {
  return (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06))
  );
}

/** An entry name that could escape a directory or confuse a path check. */
export function isUnsafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAME_CHARS) return true;
  if (name.includes('\0') || name.includes('\\')) return true;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return true;
  return name.split('/').some((segment) => segment === '..');
}

class RangeReader extends yauzl.RandomAccessReader {
  /** The first failure of the underlying storage, so it is not mistaken for a bad ZIP. */
  ioError: Error | undefined;

  constructor(private readonly source: RangeSource) {
    super();
  }

  override _readStreamForRange(start: number, end: number): Readable {
    const stream = this.source.open(start, end);
    stream.on('error', (err: Error) => {
      this.ioError ??= err;
    });
    return stream;
  }
}

async function head(source: RangeSource, bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source.open(0, Math.min(bytes, source.size))) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const extensionOf = (name: string): string => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.slice(name.lastIndexOf('/') + 1));
  return m?.[1] === undefined ? '(none)' : `.${m[1].toLowerCase()}`;
};

/** What yauzl says when the central directory or a name is not acceptable. */
const NAME_ERROR = /^(invalid characters in fileName|absolute path|invalid relative path)/;

function translateYauzl(err: unknown, reader: RangeReader): never {
  if (err instanceof LinkedinZipError || err instanceof LinkedinParseError) throw err;
  if (reader.ioError !== undefined) throw reader.ioError;
  const message = err instanceof Error ? err.message : '';
  if (NAME_ERROR.test(message)) throw new LinkedinZipError('IMPORT_UNSAFE_PATH');
  if (message.startsWith('too many bytes in the stream')) {
    throw new LinkedinZipError('IMPORT_UNCOMPRESSED_TOO_LARGE');
  }
  // Truncated or corrupt data, a method yauzl cannot inflate, a bad deflate stream.
  throw new LinkedinZipError('IMPORT_MALFORMED_CSV');
}

export async function readLinkedinZip(
  source: RangeSource,
  limits: ZipLimits,
): Promise<ZipReadResult> {
  if (!looksLikeZip(await head(source, 4))) throw new LinkedinZipError('IMPORT_NOT_ZIP');

  const reader = new RangeReader(source);
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.fromRandomAccessReaderPromise(reader, source.size, {
      lazyEntries: true,
      validateEntrySizes: true,
      // A backslash in a name is refused, not turned into a path separator.
      strictFileNames: true,
      // eachEntry would close the archive at its end, before the datasets are read.
      autoClose: false,
    });
  } catch (err) {
    if (reader.ioError !== undefined) throw reader.ioError;
    if (err instanceof Error && NAME_ERROR.test(err.message)) {
      throw new LinkedinZipError('IMPORT_UNSAFE_PATH');
    }
    throw new LinkedinZipError('IMPORT_NOT_ZIP');
  }

  try {
    if (zip.entryCount > limits.maxEntries) throw new LinkedinZipError('IMPORT_TOO_MANY_ENTRIES');

    const wanted = new Map<Dataset, yauzl.Entry>();
    const extensions: Record<string, number> = {};
    let skippedFileCount = 0;
    let declaredTotal = 0;

    try {
      for await (const entry of zip.eachEntry()) {
        const name = entry.fileName;
        if (isUnsafeEntryName(name)) throw new LinkedinZipError('IMPORT_UNSAFE_PATH');
        if (entry.isEncrypted()) throw new LinkedinZipError('IMPORT_ENCRYPTED');

        declaredTotal += entry.uncompressedSize;
        if (declaredTotal > limits.maxUncompressedBytes) {
          throw new LinkedinZipError('IMPORT_UNCOMPRESSED_TOO_LARGE');
        }
        if (
          entry.uncompressedSize >= RATIO_FLOOR_BYTES &&
          entry.uncompressedSize > Math.max(entry.compressedSize, 1) * limits.maxRatio
        ) {
          throw new LinkedinZipError('IMPORT_RATIO_EXCEEDED');
        }

        if (name.endsWith('/')) continue; // a directory

        const dataset = datasetOfEntry(name);
        if (dataset !== null && dataset !== 'profile') {
          if (wanted.has(dataset)) throw new LinkedinZipError('IMPORT_DUPLICATE_ENTRY');
          if (entry.uncompressedSize > limits.maxEntryBytes) {
            throw new LinkedinZipError('IMPORT_UNCOMPRESSED_TOO_LARGE');
          }
          wanted.set(dataset, entry);
          continue;
        }
        // `Positions.xlsx` at the top level: a dataset name that is not a CSV.
        if (!name.includes('/') && datasetByStem(name) !== null && dataset === null) {
          throw new LinkedinZipError('IMPORT_ENTRY_NOT_CSV');
        }
        skippedFileCount += 1;
        const ext = extensionOf(name);
        extensions[ext] = (extensions[ext] ?? 0) + 1;
      }
    } catch (err) {
      translateYauzl(err, reader);
    }

    const result: ZipReadResult = {
      outcomes: {},
      skippedColumns: [],
      missingFiles: [],
      skippedFileCount,
      extensions,
    };

    for (const dataset of PREVIEW_DATASETS) {
      const entry = wanted.get(dataset);
      const file = SPECS[dataset].file;
      if (entry === undefined) {
        result.missingFiles.push(file);
        continue;
      }
      let outcome: DatasetOutcome<typeof dataset>;
      try {
        // yauzl checks the inflated size against the declared one (validateEntrySizes, on by
        // default): an entry that lies about its size fails here, after at most one byte too many.
        const stream = await zip.openReadStreamPromise(entry);
        outcome = await parseLinkedinDataset(dataset, stream, {
          maxRows: limits.maxRows,
          ...(limits.maxRecordBytes === undefined ? {} : { maxRecordBytes: limits.maxRecordBytes }),
        });
      } catch (err) {
        if (err instanceof LinkedinParseError) {
          throw new LinkedinZipError('IMPORT_MALFORMED_CSV');
        }
        translateYauzl(err, reader);
      }
      switch (outcome.status) {
        case 'ok':
          (result.outcomes as Record<string, unknown>)[dataset] = outcome;
          for (const column of outcome.skippedColumns) result.skippedColumns.push({ file, column });
          break;
        case 'empty':
          result.missingFiles.push(file);
          break;
        case 'columns_missing':
          throw new LinkedinZipError('IMPORT_COLUMNS_MISSING', {
            file,
            columns: outcome.missing,
          });
        case 'unrecognised_language':
          throw new LinkedinZipError('IMPORT_LANGUAGE_UNRECOGNISED', { file });
      }
    }

    if (Object.keys(result.outcomes).length === 0) throw new LinkedinZipError('IMPORT_EMPTY');
    return result;
  } finally {
    zip.close();
  }
}
