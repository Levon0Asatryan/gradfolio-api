import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  type CreateExperience,
  createExperienceSchema,
  nonEmptyPatch,
  patchExperienceSchema,
  reorderSchema,
} from './dto/section.dto.js';
import { experienceSection, type ExperienceItem } from './repositories/experience.repository.js';
import { SectionService } from './services/section.service.js';

@Controller('me/experience')
export class ExperienceController {
  constructor(private readonly sections: SectionService) {}

  @Post()
  create(
    @CurrentUser() user: UserRow,
    @Body(zodBody(createExperienceSchema)) body: CreateExperience,
  ): Promise<ExperienceItem> {
    return this.sections.create(experienceSection, user.id, body);
  }

  /** Declared before `:id` so `order` is never read as an entry id. */
  @Put('order')
  reorder(
    @CurrentUser() user: UserRow,
    @Body(zodBody(reorderSchema)) body: { ids: string[] },
  ): Promise<ExperienceItem[]> {
    return this.sections.reorder(experienceSection, user.id, body.ids);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body(zodBody(nonEmptyPatch(patchExperienceSchema))) body: Record<string, unknown>,
  ): Promise<ExperienceItem> {
    return this.sections.update(experienceSection, createExperienceSchema, user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<void> {
    await this.sections.remove(experienceSection, user.id, id);
  }
}
