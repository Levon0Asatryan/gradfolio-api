import { describe, expect, it } from 'vitest';
import { isMysqlError, MysqlErrno, mysqlErrno } from './mysql-errors.js';

// The real codes are produced by real statements in mysql-errors.int.test.ts;
// this covers the shapes that are not server errors at all.
describe('mysqlErrno', () => {
  it('reads a server error', () => {
    const err = Object.assign(new Error('Duplicate entry'), { errno: 1062, sqlState: '23000' });
    expect(mysqlErrno(err)).toBe(MysqlErrno.DUPLICATE_KEY);
    expect(isMysqlError(err, MysqlErrno.DUPLICATE_KEY)).toBe(true);
  });

  it.each([
    ['a Node system error', Object.assign(new Error('ECONNREFUSED'), { errno: -61 })],
    ['a string', '1062'],
    ['null', null],
    ['an errno that is not a number', { errno: '1062', sqlState: '23000' }],
  ])('is undefined for %s', (_label, value) => {
    expect(mysqlErrno(value)).toBeUndefined();
  });
});
