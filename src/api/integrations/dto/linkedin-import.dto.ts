import { z } from 'zod';
import {
  createCertificationSchema,
  createEducationSchema,
  createExperienceSchema,
} from '../../profiles/dto/section.dto.js';

/**
 * The contract of the LinkedIn export import (docs/modules/m7/plan.md §4.2, §4.3; §7
 * items 8–10). Documented in openapi.yaml now; served from M7 PR (c). The ZIP
 * goes from the browser straight to the bucket; the API derives its key from
 * the caller and the upload id, so a client never names a key or a URL.
 */

export const linkedinUploadRequestSchema = z.strictObject({
  size: z.number().int().min(1).max(100_000_000).meta({
    description:
      'Exact size of the ZIP in bytes, at most IMPORT_MAX_ZIP_BYTES; signed into the URL.',
  }),
});

export const linkedinUploadResponseSchema = z
  .object({
    uploadId: z.string().meta({ description: 'Send this to `preview` after the upload.' }),
    uploadUrl: z.string().meta({ description: 'PUT the ZIP here, from the browser.' }),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()).meta({
      description: 'Send these headers exactly: they are part of the signature.',
    }),
    expiresAt: z.string().meta({ description: 'ISO 8601, UTC.' }),
  })
  .meta({ id: 'LinkedinUploadTicket' });

export const linkedinPreviewRequestSchema = z.strictObject({
  uploadId: z.uuid(),
});

const problemSchema = z.object({
  field: z.string(),
  code: z.string().meta({ example: 'DATE_NEEDS_MONTH' }),
});

const previewItem = z.object({
  status: z.enum(['new', 'duplicate', 'invalid']),
  fields: z.record(z.string(), z.unknown()).meta({
    description: 'The proposed entry, in the shape of the manual-entry body for its section.',
  }),
  problems: z.array(problemSchema),
});

export const linkedinPreviewResponseSchema = z
  .object({
    experience: z.array(previewItem),
    education: z.array(previewItem),
    certifications: z.array(previewItem),
    skills: z.array(
      z.object({ name: z.string(), status: z.enum(['new', 'duplicate', 'invalid']) }),
    ),
    skippedColumns: z.array(z.object({ file: z.string(), column: z.string() })),
    missingFiles: z.array(z.string()),
    skippedFileCount: z.number().int(),
    extensions: z.record(z.string(), z.number().int()).meta({
      description: 'How many other entries the archive held, by extension. Never their names.',
    }),
  })
  .meta({ id: 'LinkedinPreview' });

export const linkedinConfirmRequestSchema = z.strictObject({
  experience: z.array(createExperienceSchema).max(500),
  education: z.array(createEducationSchema).max(500),
  certifications: z.array(createCertificationSchema).max(500),
  skills: z.array(z.string().trim().min(1).max(100)).max(1000),
});

const perSection = z.object({
  experience: z.number().int(),
  education: z.number().int(),
  certifications: z.number().int(),
  skills: z.number().int(),
});

export const linkedinConfirmResponseSchema = z
  .object({ added: perSection, skipped: perSection })
  .meta({ id: 'LinkedinImportResult' });
