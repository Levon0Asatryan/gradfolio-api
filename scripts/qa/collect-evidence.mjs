import { readFile, writeFile } from 'node:fs/promises';
const read = async (name) => JSON.parse(await readFile(`/qa/results/${name}`, 'utf8'));
const journeys = new Map();
for (const path of [
  'journeys/results.json',
  'journeys-recheck/results.json',
  'education-recheck/results.json',
]) {
  for (const result of await read(path)) journeys.set(result.id, result);
}
const summary = {
  date: '2026-10-17',
  frontendCommit: '9d6b214 plus local fixes',
  apiCommit: 'f131ba6',
  identity: 'local test issuer and Auth0 SDK test session cookies, not hosted Auth0 login',
  matrix: (await read('signed-in-matrix.json')).stats,
  matrixBeforeFixes: (await read('signed-in-matrix-before-fixes.json')).stats,
  extraConsoleRegression: { passed: 3, overlapWithMatrix: 2 },
  journeys: [...journeys.values()].sort((a, b) => a.id.localeCompare(b.id)),
  operations: await read('operations/results.json'),
  databaseOutage: await read('recovery-503.json'),
  databaseRecovery: await read('recovery-200.json'),
  migrationRollback: 'isolated qa_rollback: up 0001-0009, down 0009, up 0009, up no-op',
  dependencyAudits: {},
};
for (const name of ['frontend', 'api', 'frontend-production', 'api-production']) {
  summary.dependencyAudits[name] = (await read(`${name}-audit.json`)).metadata.vulnerabilities;
}
await writeFile('/qa/results/final-summary.json', JSON.stringify(summary, null, 2));
console.log(
  JSON.stringify({
    matrix: summary.matrix,
    journeys: summary.journeys.length,
    failedJourneys: summary.journeys.filter((item) => item.status !== 'pass').length,
  }),
);
