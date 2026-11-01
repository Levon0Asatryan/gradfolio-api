import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { LinkedinParseError } from './errors.js';

/**
 * CSV records from a byte stream, one at a time; nothing is buffered beyond one record.
 *
 * `bom` strips a UTF-8 byte-order mark; quoted commas, quotes and line breaks are RFC 4180;
 * a stray quote is an error (no `relax_quotes`), so a damaged file fails loudly instead of
 * yielding shifted columns. Ragged rows are allowed: LinkedIn pads nothing.
 */
export async function* csvRecords(
  input: AsyncIterable<Uint8Array | string>,
  maxRecordBytes: number,
): AsyncGenerator<string[]> {
  const parser = parse({
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    max_record_size: maxRecordBytes,
  });
  // pipeline forwards an input failure to the parser, so the loop below throws it.
  const piped = pipeline(Readable.from(input), parser).catch(() => undefined);
  try {
    for await (const record of parser) yield record as string[];
  } catch (err) {
    throw translate(err);
  } finally {
    parser.destroy();
    await piped;
  }
}

function translate(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !code.startsWith('CSV_')) return err;
  return new LinkedinParseError(
    code === 'CSV_MAX_RECORD_SIZE' ? 'RECORD_TOO_LARGE' : 'MALFORMED_CSV',
  );
}
