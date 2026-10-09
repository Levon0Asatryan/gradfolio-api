import { describe, expect, it } from 'vitest';
import { uploadRequestSchema } from './upload.dto.js';

describe('uploadRequestSchema', () => {
  const ok = { purpose: 'avatar', contentType: 'image/png', size: 10 };
  it('takes a valid request, with or without a project', () => {
    expect(uploadRequestSchema.parse(ok)).toEqual(ok);
    expect(uploadRequestSchema.parse({ ...ok, purpose: 'hero', projectId: 'p' }).projectId).toBe(
      'p',
    );
  });
  it.each([
    ['an unknown key', { ...ok, x: 1 }],
    ['svg', { ...ok, contentType: 'image/svg+xml' }],
    ['html', { ...ok, contentType: 'text/html' }],
    ['a bad purpose', { ...ok, purpose: 'banner' }],
    ['size 0', { ...ok, size: 0 }],
    ['a fractional size', { ...ok, size: 1.5 }],
    ['a string size', { ...ok, size: '10' }],
    ['a long project id', { ...ok, projectId: 'x'.repeat(37) }],
  ])('refuses %s', (_name, body) => {
    expect(uploadRequestSchema.safeParse(body).success).toBe(false);
  });
});
