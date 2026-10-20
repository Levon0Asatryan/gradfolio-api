import { Module } from '@nestjs/common';
import { EmailController } from './email.controller.js';

@Module({ controllers: [EmailController] })
export class EmailModule {}
