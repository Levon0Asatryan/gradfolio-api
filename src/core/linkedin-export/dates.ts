/**
 * Dates in a LinkedIn export. Seen on a real export: `Mon YYYY` (English three-letter
 * month). Also accepted: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `D Mon YYYY` and `Mon D, YYYY`.
 * Anything else (`03/04/2020` is day-first or month-first, nobody can tell) is reported
 * as unparsed. A date is never guessed, and a missing month is never invented.
 */

export type ParsedDate =
  | { kind: 'empty' }
  | { kind: 'year'; year: number }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'unparsed' };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const monthNumber = (name: string): number => MONTHS.indexOf(name.toLowerCase()) + 1;

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

const validYear = (y: number) => y >= YEAR_MIN && y <= YEAR_MAX;

function validDay(year: number, month: number, day: number): boolean {
  if (day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseLinkedinDate(raw: string): ParsedDate {
  const s = raw.trim();
  if (s === '') return { kind: 'empty' };

  let m = /^(\d{4})$/.exec(s);
  if (m) {
    const year = Number(m[1]);
    return validYear(year) ? { kind: 'year', year } : { kind: 'unparsed' };
  }

  m = /^([A-Za-z]{3}) (\d{4})$/.exec(s);
  if (m) {
    const month = monthNumber(m[1] ?? '');
    const year = Number(m[2]);
    return month > 0 && validYear(year) ? { kind: 'month', year, month } : { kind: 'unparsed' };
  }

  m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const ok =
      validYear(year) &&
      month >= 1 &&
      month <= 12 &&
      (m[3] === undefined || validDay(year, month, Number(m[3])));
    return ok ? { kind: 'month', year, month } : { kind: 'unparsed' };
  }

  m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(s);
  if (m) return fullDate(m[3], monthNumber(m[2] ?? ''), m[1]);

  m = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(s);
  if (m) return fullDate(m[3], monthNumber(m[1] ?? ''), m[2]);

  return { kind: 'unparsed' };
}

function fullDate(y: string | undefined, month: number, d: string | undefined): ParsedDate {
  const year = Number(y);
  const day = Number(d);
  if (month < 1 || !validYear(year) || !validDay(year, month, day)) return { kind: 'unparsed' };
  return { kind: 'month', year, month };
}

export const toYearMonth = (d: { year: number; month: number }): string =>
  `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}`;
