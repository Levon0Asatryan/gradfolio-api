/** Why a LinkedIn CSV could not be read at all. Stable codes; the upload layer maps them. */
export type LinkedinParseErrorCode = 'MALFORMED_CSV' | 'RECORD_TOO_LARGE' | 'TOO_MANY_ROWS';

export class LinkedinParseError extends Error {
  constructor(readonly code: LinkedinParseErrorCode) {
    // The message is the code only: a CSV library's message can quote the offending row.
    super(code);
    this.name = 'LinkedinParseError';
  }
}
