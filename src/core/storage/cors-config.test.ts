import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { uploadHeaders } from './upload-headers.js';

interface CorsRule {
  origin: string[];
  method: string[];
  responseHeader: string[];
  maxAgeSeconds: number;
}
const rules = JSON.parse(
  readFileSync(new URL('../../../docker/gcs-cors.json', import.meta.url), 'utf8'),
) as CorsRule[];

describe('docker/gcs-cors.json (the bucket CORS rule)', () => {
  it('names every header a signed upload sends, so the browser preflight passes', () => {
    const allowed = rules.flatMap((r) => r.responseHeader).map((h) => h.toLowerCase());
    for (const header of ['content-type', ...Object.keys(uploadHeaders(1))]) {
      expect(allowed, header).toContain(header.toLowerCase());
    }
  });

  it('allows PUT only, from the listed origins only, and no wildcard', () => {
    expect(rules).toHaveLength(1);
    const [rule] = rules as [CorsRule];
    expect(rule.method).toEqual(['PUT']);
    expect(rule.origin).not.toContain('*');
    for (const o of rule.origin) expect(o).toMatch(/^https:\/\/[^*]+$|^http:\/\/localhost:\d+$/);
  });
});
