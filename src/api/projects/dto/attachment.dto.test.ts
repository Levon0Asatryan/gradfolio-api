import { describe, expect, it } from 'vitest';
import { createAttachmentSchema, patchAttachmentSchema } from './attachment.dto.js';

describe('createAttachmentSchema', () => {
  it('trims, defaults the title and keeps the type', () => {
    expect(
      createAttachmentSchema.parse({ type: 'link', url: ' https://a.example/x ', title: '  ' }),
    ).toEqual({ type: 'link', url: 'https://a.example/x', title: null });
    expect(
      createAttachmentSchema.parse({ type: 'pdf', url: 'https://a.example/r.pdf' }).title,
    ).toBeNull();
  });
  it.each([
    ['http', { type: 'link', url: 'http://a.example' }],
    ['credentials', { type: 'link', url: 'https://u:p@a.example' }],
    ['javascript:', { type: 'link', url: 'javascript:alert(1)' }],
    ['a bad type', { type: 'audio', url: 'https://a.example' }],
    [
      'server-owned keys',
      { type: 'link', url: 'https://a.example', thumbnailUrl: 'https://b.example' },
    ],
  ])('refuses %s', (_name, body) => {
    expect(createAttachmentSchema.safeParse(body).success).toBe(false);
  });
});

describe('patchAttachmentSchema', () => {
  it('needs a field and refuses the type', () => {
    expect(patchAttachmentSchema.safeParse({}).success).toBe(false);
    expect(patchAttachmentSchema.safeParse({ type: 'link' }).success).toBe(false);
    expect(patchAttachmentSchema.parse({ title: null })).toEqual({ title: null });
    expect(patchAttachmentSchema.parse({ url: 'https://a.example' })).toEqual({
      url: 'https://a.example',
    });
  });
});
