import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../../core/config/config.module.js';
import type { AppConfig } from '../../../core/config/schema.js';
import { DbService } from '../../../core/db/db.service.js';
import type { ResumeRequest } from '../dto/resume.dto.js';
import { snapshotResume } from '../repositories/resume.repository.js';
import { renderResume } from '../utils/render-resume.js';

@Injectable()
export class ResumeService {
  constructor(
    private readonly dbs: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async generate(userId: string, input: ResumeRequest): Promise<Buffer> {
    return renderResume(await this.snapshot(userId, input), this.cfg);
  }

  snapshot(userId: string, input: ResumeRequest) {
    return snapshotResume(this.dbs.db, this.cfg.RESUME_MAX_PROJECTS, userId, input);
  }
}
