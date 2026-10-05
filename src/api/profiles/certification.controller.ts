import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  type CreateCertification,
  createCertificationSchema,
  nonEmptyPatch,
  patchCertificationSchema,
  reorderSchema,
} from './dto/section.dto.js';
import {
  certificationSection,
  type CertificationItem,
} from './repositories/certification.repository.js';
import { SectionService } from './services/section.service.js';

@Controller('me/certifications')
export class CertificationController {
  constructor(private readonly sections: SectionService) {}

  @Post()
  create(
    @CurrentUser() user: UserRow,
    @Body(zodBody(createCertificationSchema)) body: CreateCertification,
  ): Promise<CertificationItem> {
    return this.sections.create(certificationSection, user.id, body);
  }

  /** Declared before `:id` so `order` is never read as an entry id. */
  @Put('order')
  reorder(
    @CurrentUser() user: UserRow,
    @Body(zodBody(reorderSchema)) body: { ids: string[] },
  ): Promise<CertificationItem[]> {
    return this.sections.reorder(certificationSection, user.id, body.ids);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body(zodBody(nonEmptyPatch(patchCertificationSchema))) body: Record<string, unknown>,
  ): Promise<CertificationItem> {
    return this.sections.update(certificationSection, createCertificationSchema, user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<void> {
    await this.sections.remove(certificationSection, user.id, id);
  }
}
