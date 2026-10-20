import { Body, Controller, Header, HttpCode, Post, StreamableFile } from '@nestjs/common';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { RateBudget } from '../rate-limit/decorators/rate-budget.decorator.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import { resumeRequestSchema, type ResumeRequest } from './resume.dto.js';
import { ResumeService } from './resume.service.js';

@Controller('me/resume')
export class ResumeController {
  constructor(private readonly resumes: ResumeService) {}

  @Post()
  @HttpCode(200)
  @RateBudget('pdf')
  @Header('Cache-Control', 'private, no-store')
  async generate(
    @CurrentUser() user: UserRow,
    @Body(zodBody(resumeRequestSchema)) input: ResumeRequest,
  ) {
    return new StreamableFile(await this.resumes.generate(user.id, input), {
      type: 'application/pdf',
      disposition: 'attachment; filename="gradfolio-resume.pdf"',
    });
  }
}
