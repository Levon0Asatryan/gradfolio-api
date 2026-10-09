import { z } from 'zod';
import { httpsUrl } from '../../../core/validation/http-url.js';
import { TEXT } from '../../../core/validation/text.js';
import { nullableText } from '../../profiles/dto/fields.js';

export const ATTACHMENT_TYPES = ['image', 'video', 'pdf', 'link'] as const;

/**
 * Attachments of a project. The type is fixed when the attachment is created.
 * Every URL is https without credentials; per-type rules (the video host
 * allow-list, registering an uploaded image or PDF) run in the service.
 * Strict: `id`, `sortOrder`, `thumbnailUrl`, `embedUrl` and the like are a 400;
 * the server computes thumbnails and embeds.
 */
export const createAttachmentSchema = z.strictObject({
  type: z.enum(ATTACHMENT_TYPES),
  url: z.string().trim().pipe(httpsUrl(TEXT)),
  title: nullableText('project_attachments.title').default(null),
});

export const patchAttachmentSchema = z
  .strictObject({
    url: z.string().trim().pipe(httpsUrl(TEXT)),
    title: nullableText('project_attachments.title'),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'must change at least one field',
  });

export const attachmentParamsSchema = z.object({
  id: z.string().meta({ description: 'The project id (UUID)', example: '0b6f2c1e-…' }),
  attachmentId: z.string().meta({ description: 'The attachment id (UUID)' }),
});

export type CreateAttachment = z.output<typeof createAttachmentSchema>;
export type PatchAttachment = z.output<typeof patchAttachmentSchema>;
