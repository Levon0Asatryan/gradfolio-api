import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  linkedinPreviewRequestSchema,
  linkedinUploadRequestSchema,
} from './dto/linkedin-import.dto.js';
import { LinkedinImportService } from './services/linkedin-import.service.js';

/**
 * The LinkedIn export import (docs/modules/m7/plan.md §4, §7 items 8–10). No route takes a
 * key or a URL: the object key is derived from the caller and the upload id. Each route has
 * its own counter under the tighter `linkedin` budget.
 */
@Controller('me/imports/linkedin')
@RateBudget('linkedin')
export class LinkedinImportController {
  constructor(private readonly linkedin: LinkedinImportService) {}

  @Post('uploads')
  @HttpCode(201)
  upload(
    @CurrentUser() user: UserRow,
    @Body(zodBody(linkedinUploadRequestSchema))
    body: ReturnType<typeof linkedinUploadRequestSchema.parse>,
  ) {
    return this.linkedin.createUpload(user, body);
  }

  @Post('preview')
  @HttpCode(200)
  preview(
    @CurrentUser() user: UserRow,
    @Body(zodBody(linkedinPreviewRequestSchema))
    body: ReturnType<typeof linkedinPreviewRequestSchema.parse>,
  ) {
    return this.linkedin.preview(user, body);
  }
}
