/** Why a LinkedIn CSV could not be read at all. Stable codes; the upload layer maps them. */
export type LinkedinParseErrorCode = 'MALFORMED_CSV' | 'RECORD_TOO_LARGE' | 'TOO_MANY_ROWS';

export class LinkedinParseError extends Error {
  constructor(readonly code: LinkedinParseErrorCode) {
    // The message is the code only: a CSV library's message can quote the offending row.
    super(code);
    this.name = 'LinkedinParseError';
  }
}

/**
 * Why an export ZIP was refused. The code is the API's. `details` never holds archive content (entry names
 * can carry contact names); only dataset file names and column names, which are fixed.
 */
export type LinkedinZipErrorCode =
  | 'IMPORT_NOT_ZIP'
  | 'IMPORT_TOO_MANY_ENTRIES'
  | 'IMPORT_UNCOMPRESSED_TOO_LARGE'
  | 'IMPORT_RATIO_EXCEEDED'
  | 'IMPORT_UNSAFE_PATH'
  | 'IMPORT_ENCRYPTED'
  | 'IMPORT_ENTRY_NOT_CSV'
  | 'IMPORT_DUPLICATE_ENTRY'
  | 'IMPORT_EMPTY'
  | 'IMPORT_COLUMNS_MISSING'
  | 'IMPORT_LANGUAGE_UNRECOGNISED'
  | 'IMPORT_MALFORMED_CSV';

export class LinkedinZipError extends Error {
  constructor(
    readonly code: LinkedinZipErrorCode,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'LinkedinZipError';
  }
}
