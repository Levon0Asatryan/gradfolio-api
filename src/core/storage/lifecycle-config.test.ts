import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IMPORTS_ROOT } from './file-rules.js';

interface Rule {
  action: { type: string };
  condition: { age: number; matchesPrefix: string[] };
}
const { rule } = JSON.parse(
  readFileSync(new URL('../../../docker/gcs-lifecycle.json', import.meta.url), 'utf8'),
) as { rule: Rule[] };

describe('docker/gcs-lifecycle.json (the bucket lifecycle rule)', () => {
  it('deletes export ZIPs after one day, under imports/ only', () => {
    expect(rule).toHaveLength(1);
    const [r] = rule as [Rule];
    expect(r.action.type).toBe('Delete');
    expect(r.condition.age).toBe(1);
    expect(r.condition.matchesPrefix).toEqual([IMPORTS_ROOT]);
  });
});
