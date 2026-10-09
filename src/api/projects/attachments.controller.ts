import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import type { ProjectAttachment } from './dto/project.dto.js';
import { AttachmentService } from './services/attachment.service.js';

/** Bodies are validated in the service, which owns the per-type rules and the limits. */
@Controller('projects/:id/attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentService) {}

  @Post()
  add(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProjectAttachment> {
    return this.attachments.add(user.id, id, body);
  }

  /** Declared before `:attachmentId` so `order` is never read as an id. */
  @Put('order')
  reorder(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProjectAttachment[]> {
    return this.attachments.reorder(user.id, id, body);
  }

  @Patch(':attachmentId')
  update(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: unknown,
  ): Promise<ProjectAttachment> {
    return this.attachments.update(user.id, id, attachmentId, body);
  }

  @Delete(':attachmentId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.attachments.remove(user.id, id, attachmentId);
  }
}
