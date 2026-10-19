import assert from 'node:assert/strict';
import test from 'node:test';
import { requireQaDatabase } from './qa-database.mjs';

test('permits only the disposable QA MySQL target', () => {
  for (const value of [
    'mysql://gradfolio:gradfolio@gradfolio-qa-mysql-20261017:3306/gradfolio',
    'mysql://gradfolio:gradfolio@gradfolio-qa-mysql-20261017/gradfolio',
  ])
    assert.equal(requireQaDatabase(value), value);
});

test('rejects production URLs that merely contain the QA name and all other targets', () => {
  for (const value of [
    undefined,
    'not a URL',
    'mysql://gradfolio:gradfolio@production.example/gradfolio?qa=gradfolio-qa-mysql-20261017',
    'mysql://gradfolio-qa-mysql-20261017:password@production.example/gradfolio',
    'mysql://gradfolio:gradfolio@gradfolio-qa-mysql-20261017.production.example/gradfolio',
    'mysql://gradfolio:gradfolio@gradfolio-qa-mysql-20261017:3307/gradfolio',
    'mysql://gradfolio:gradfolio@gradfolio-qa-mysql-20261017/production',
    'https://gradfolio-qa-mysql-20261017/gradfolio',
    'mysql://gradfolio:gradfolio@gradfolio-qa-mysql-20261017/gradfolio?socketPath=/production',
  ])
    assert.throws(() => requireQaDatabase(value), /QA requires/);
});

test('rejects a socket override that would replace the checked database host', () => {
  assert.throws(
    () =>
      requireQaDatabase(
        'mysql://gradfolio:gradfolio@gradfolio-qa-mysql-20261017/gradfolio',
        '/cloudsql/production',
      ),
    /QA requires/,
  );
});
