/**
 * Turns what a visitor typed into something safe and meaningful for MySQL
 * (docs/m6-plan.md §3.3). Pure: no I/O.
 *
 * Why tokens are classified rather than passed through (all found by running
 * them on MySQL 8.4.11, plan §1.4):
 *
 * - FULLTEXT ignores words under 3 characters, so `AI`, `ML`, `Go` need another
 *   path;
 * - InnoDB's stopwords (`the`, `an`, ...) are dropped from the index, and a
 *   **required** stopword (`+the`) makes the whole query return nothing;
 * - an operator character (`+(`, `@3`, `*`) in a boolean-mode string is a
 *   syntax error, a 500 if it is passed through.
 */

/** Longest query, in characters (not bytes). */
export const QUERY_MAX_CHARS = 100;
export const QUERY_MAX_TOKENS = 6;
export const TOKEN_MAX_CHARS = 50;

/**
 * InnoDB's default stopword list (`INNODB_FT_DEFAULT_STOPWORD`, MySQL 8.4.11).
 * `search-tokens.int.test.ts` compares it with the server's own, so a server
 * that changes it fails a test instead of returning silent zeros.
 */
export const FT_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'about',
  'an',
  'are',
  'as',
  'at',
  'be',
  'by',
  'com',
  'de',
  'en',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'la',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'und',
  'was',
  'what',
  'when',
  'where',
  'who',
  'will',
  'with',
  'www',
]);

/**
 * - `long`: letters and digits only, 3 or more characters, not a stopword:
 *   FULLTEXT can serve it.
 * - `short`: anything else with 2 or more characters (`ML`, `C#`, `C++`,
 *   `CI/CD`): word-start `LIKE` plus an exact registered term.
 * - `single`: one character (`R`, `C`): an exact registered term only, never a
 *   prefix, so `a` is not "everything starting with a".
 */
export type TokenKind = 'long' | 'short' | 'single';

export interface Token {
  text: string;
  kind: TokenKind;
}

export interface ParsedQuery {
  /** The normalized text, whole. Echoed in responses and compared for rank 3. */
  text: string;
  /** The tokens every result must match. Never empty for a non-empty query. */
  tokens: Token[];
}

/** NFKC, control and format characters removed, whitespace collapsed and trimmed. */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export const charCount = (s: string) => Array.from(s).length;

const WORD = /^[\p{L}\p{N}]+$/u;

/** One word of a query on its own, before stopwords are considered. */
function classify(text: string): TokenKind {
  const n = charCount(text);
  if (n === 1) return 'single';
  if (n >= 3 && WORD.test(text)) return 'long';
  return 'short';
}

const isStopword = (text: string) => FT_STOPWORDS.has(text.toLowerCase());

/**
 * `normalized` is the output of `normalizeText`; the caller has already checked
 * the limits. Stopwords are dropped when another token remains (`the chat` is
 * `chat`); a query that is only stopwords keeps them, as `short` tokens, or as
 * `single` for one character (`a`), whose rule wins.
 */
export function parseQuery(normalized: string): ParsedQuery {
  const words = normalized.length === 0 ? [] : normalized.split(' ');
  const meaningful = words.filter((w) => !isStopword(w));
  const used = meaningful.length > 0 ? meaningful : words;
  return {
    text: normalized,
    tokens: used.map((text) => ({
      text,
      // A stopword that stays (stopwords only) is never `long`: FULLTEXT would
      // drop it, and a required stopword empties the query.
      kind: classify(text) === 'long' && isStopword(text) ? 'short' : classify(text),
    })),
  };
}

/** `%`, `_` and `\` in a visitor's text are text, not wildcards. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
