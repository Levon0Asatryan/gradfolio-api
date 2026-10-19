/** These scripts may seed/delete data only in the disposable QA database. */
export function requireQaDatabase(value, socketPath) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error('QA requires a valid isolated MySQL DATABASE_URL');
  }
  if (
    url.protocol !== 'mysql:' ||
    url.hostname !== 'gradfolio-qa-mysql-20261017' ||
    (url.port !== '' && url.port !== '3306') ||
    url.pathname !== '/gradfolio' ||
    url.search !== '' ||
    url.hash !== '' ||
    (socketPath !== undefined && socketPath !== '')
  ) {
    throw new Error('QA requires gradfolio-qa-mysql-20261017:3306/gradfolio');
  }
  return value;
}
