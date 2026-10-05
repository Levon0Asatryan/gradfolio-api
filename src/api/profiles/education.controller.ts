import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  type CreateEducation,
  createEducationSchema,
  nonEmptyPatch,
  patchEducationSchema,
  reorderSchema,
} from './dto/section.dto.js';
import { educationSection, type EducationItem } from './repositories/education.repository.js';
import { SectionService } from './services/section.service.js';

@Controller('me/education')
export class EducationController {
  constructor(private readonly sections: SectionService) {}

  @Post()
  create(
    @CurrentUser() user: UserRow,
    @Body(zodBody(createEducationSchema)) body: CreateEducation,
  ): Promise<EducationItem> {
    return this.sections.create(educationSection, user.id, body);
  }

  /** Declared before `:id` so `order` is never read as an entry id. */
  @Put('order')
  reorder(
    @CurrentUser() user: UserRow,
    @Body(zodBody(reorderSchema)) body: { ids: string[] },
  ): Promise<EducationItem[]> {
    return this.sections.reorder(educationSection, user.id, body.ids);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body(zodBody(nonEmptyPatch(patchEducationSchema))) body: Record<string, unknown>,
  ): Promise<EducationItem> {
    return this.sections.update(educationSection, createEducationSchema, user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<void> {
    await this.sections.remove(educationSection, user.id, id);
  }
}
