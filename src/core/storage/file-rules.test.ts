import { describe, expect, it } from 'vitest';
import {
  canonicalObjectUrl,
  matchesMagic,
  newObjectKey,
  objectKeyOf,
  type UploadType,
} from './file-rules.js';

const B = 'my-bucket';
const bytes = (...b: number[]) => Buffer.from(b);
const ascii = (s: string) => Buffer.from(s, 'latin1');

describe('matchesMagic', () => {
  const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2);
  const cases: [UploadType, Buffer][] = [
    ['image/png', PNG],
    ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)],
    ['image/gif', ascii('GIF89a......')],
    ['image/webp', Buffer.concat([ascii('RIFF'), bytes(1, 2, 3, 4), ascii('WEBP')])],
    ['application/pdf', ascii('%PDF-1.7\n')],
  ];
  it.each(cases)('recognises %s', (type, head) => {
    expect(matchesMagic(type, head)).toBe(true);
  });
  it('refuses every type for the wrong bytes, and for HTML dressed as an image', () => {
    for (const [type] of cases) {
      expect(matchesMagic(type, ascii('<html><script>alert(1)</script>'))).toBe(false);
      expect(matchesMagic(type, Buffer.alloc(0))).toBe(false);
    }
    for (const [type, head] of cases) {
      for (const [other] of cases) {
        if (other !== type) expect(matchesMagic(other, head), `${type} as ${other}`).toBe(false);
      }
    }
  });
});

describe('object keys and URLs', () => {
  it('builds keys under the user prefix with the extension of the verified type', () => {
    const key = newObjectKey('user-1', 'image/jpeg');
    expect(key).toMatch(/^u\/user-1\/[0-9a-f-]{36}\.jpg$/);
    expect(newObjectKey('user-1', 'application/pdf')).toMatch(/\.pdf$/);
    expect(newObjectKey('user-1', 'image/png')).not.toBe(newObjectKey('user-1', 'image/png'));
  });

  it('recognises our objects in every form a client may send back, signed or not', () => {
    const key = 'u/user-1/abc.png';
    expect(objectKeyOf(canonicalObjectUrl(B, key), B)).toBe(key);
    expect(
      objectKeyOf(`${canonicalObjectUrl(B, key)}?X-Goog-Signature=zz&X-Goog-Expires=300`, B),
    ).toBe(key);
    expect(objectKeyOf(`https://storage.googleapis.com/${B}/${key}`, B)).toBe(key);
    expect(objectKeyOf(`https://${B}.storage.googleapis.com/u%2Fuser-1%2Fabc.png`, B)).toBe(key);
  });

  it('reads the *normalized* path, so a dot-dot cannot walk out of the caller’s prefix unseen', () => {
    // WHATWG URL resolves the dots before we see the path; the prefix check then runs on
    // the key the object store would use, and refuses another user's.
    const walk = `https://${B}.storage.googleapis.com/u/user-1/../user-2/a.png`;
    expect(objectKeyOf(walk, B)).toBe('u/user-2/a.png');
    expect(objectKeyOf(`https://${B}.storage.googleapis.com/u/user-1/%2e%2e/user-2/a.png`, B)).toBe(
      'u/user-2/a.png',
    );
    expect(
      objectKeyOf(`https://${B}.storage.googleapis.com/u/user-1/a%2f..%2fb.png`, B),
    ).toBeNull();
  });

  it.each([
    ['another bucket', 'https://other.storage.googleapis.com/u/user-1/a.png'],
    ['another bucket, path style', 'https://storage.googleapis.com/other/u/user-1/a.png'],
    ['a lookalike host', `https://${B}.storage.googleapis.com.evil.example/u/user-1/a.png`],
    ['credentials', `https://x:y@${B}.storage.googleapis.com/u/user-1/a.png`],
    ['http', `http://${B}.storage.googleapis.com/u/user-1/a.png`],
    ['a path-style prefix trick', `https://storage.googleapis.com/${B}evil/u/user-1/a.png`],
    ['no key', `https://${B}.storage.googleapis.com/`],
    ['an external image', 'https://images.example/a.png'],
    ['not a URL', 'nope'],
  ])('does not take %s for ours', (_name, url) => {
    expect(objectKeyOf(url, B)).toBeNull();
  });
});
