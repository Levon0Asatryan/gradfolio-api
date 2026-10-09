import { z } from 'zod';
import { IMAGE_TYPES, PDF_TYPE } from '../../../core/storage/file-rules.js';

export const UPLOAD_PURPOSES = ['avatar', 'hero', 'attachment'] as const;

/**
 * `POST /v1/me/uploads`: what the browser is about to upload. The type and the
 * exact size are signed into the URL, so they are promises the upload cannot
 * break. Limits per type are checked in the service, against configuration.
 */
export const uploadRequestSchema = z.strictObject({
  purpose: z.enum(UPLOAD_PURPOSES),
  contentType: z.enum([...IMAGE_TYPES, PDF_TYPE]),
  size: z.number().int().min(1).meta({ description: 'Exact size in bytes; signed into the URL.' }),
  projectId: z.string().max(36).optional().meta({
    description:
      'Optional for `hero` and `attachment` (omit it while the project is being created); when given, a project of the caller’s. Not allowed for `avatar`.',
  }),
});
export type UploadRequest = z.output<typeof uploadRequestSchema>;

export const uploadResponseSchema = z
  .object({
    uploadUrl: z.string().meta({ description: 'PUT the file here. Valid for `expiresAt`.' }),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()).meta({
      description: 'Send these headers exactly: they are part of the signature.',
    }),
    fileUrl: z.string().meta({
      description:
        'After the upload, send this as `avatarUrl`, `heroImageUrl` or an attachment `url`.',
    }),
    expiresAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
  })
  .meta({ id: 'UploadTicket' });
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
