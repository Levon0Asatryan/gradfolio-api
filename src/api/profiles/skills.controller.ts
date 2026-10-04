import { Body, Controller, Put } from '@nestjs/common';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import { replaceSkillsSchema } from './dto/section.dto.js';
import { SkillsService } from './services/skills.service.js';

@Controller('me/skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Put()
  async replace(
    @CurrentUser() user: UserRow,
    @Body(zodBody(replaceSkillsSchema)) body: { skills: string[] },
  ): Promise<{ skills: string[] }> {
    return { skills: await this.skills.replace(user.id, body.skills) };
  }
}
