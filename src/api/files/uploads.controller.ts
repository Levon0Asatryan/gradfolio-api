import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import type { UploadResponse } from './dto/upload.dto.js';
import { UploadsService } from './services/uploads.service.js';

@Controller('me/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Validated in the service, against limits from configuration. */
  @Post()
  @HttpCode(201)
  @RateBudget('upload')
  sign(@CurrentUser() user: UserRow, @Body() body: unknown): Promise<UploadResponse> {
    return this.uploads.sign(user.id, body);
  }
}
