import { Module } from '@nestjs/common';
import { ResumeController } from './resume.controller.js';
import { ResumeService } from './resume.service.js';

@Module({ controllers: [ResumeController], providers: [ResumeService] })
export class ResumeModule {}
