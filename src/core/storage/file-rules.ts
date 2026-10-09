import { randomUUID } from 'node:crypto';

/** What may be uploaded, and how to recognise it (docs/m4-plan.md §3.5). No SVG, no HTML. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const PDF_TYPE = 'application/pdf';
export type UploadType = (typeof IMAGE_TYPES)[number] | typeof PDF_TYPE;

const EXTENSIONS: Record<UploadType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

export const isImageType = (t: string): t is (typeof IMAGE_TYPES)[number] =>
  (IMAGE_TYPES as readonly string[]).includes(t);
export const isUploadType = (t: string): t is UploadType => isImageType(t) || t === PDF_TYPE;

/** Bytes to read from the start of an object to recognise it. */
export const MAGIC_BYTES = 12;

/** Whether `head` (the first bytes) is what `type` claims to be. */
export function matchesMagic(type: UploadType, head: Buffer): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  switch (type) {
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/gif':
      return head.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'image/webp':
      return (
        head.subarray(0, 4).toString('latin1') === 'RIFF' &&
        head.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'application/pdf':
      return head.subarray(0, 5).toString('latin1') === '%PDF-';
  }
}

export const userPrefix = (userId: string) => `u/${userId}/`;

/** A fresh key under the user's prefix; the extension follows the verified type, not the client's filename. */
export const newObjectKey = (userId: string, type: UploadType) =>
  `${userPrefix(userId)}${randomUUID()}.${EXTENSIONS[type]}`;

/** The one form stored in the database and returned by `POST /me/uploads`. */
export const canonicalObjectUrl = (bucket: string, key: string) =>
  `https://${bucket}.storage.googleapis.com/${key}`;

/**
 * The object key if `url` points into `bucket` (virtual-host or path style,
 * with or without a signature in the query), else `null`. Anything else is an
 * external URL and stays one.
 */
export function objectKeyOf(url: string, bucket: string): string | null {
  const u = URL.parse(url);
  if (u?.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
  let path: string;
  if (u.hostname === `${bucket}.storage.googleapis.com`) path = u.pathname;
  else if (u.hostname === 'storage.googleapis.com' && u.pathname.startsWith(`/${bucket}/`)) {
    path = u.pathname.slice(bucket.length + 1);
  } else return null;
  let key: string;
  try {
    key = decodeURIComponent(path.slice(1));
  } catch {
    return null;
  }
  return key === '' || key.includes('..') || key.includes('//') ? null : key;
}
