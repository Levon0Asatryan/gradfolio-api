import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../core/config/config.module.js';
import type { AppConfig } from '../../core/config/schema.js';
import { FILE_STORAGE, type FileStorage } from '../../core/storage/file-storage.js';
import { GcsFileStorage } from '../../core/storage/gcs-file-storage.js';
import { UploadsController } from './uploads.controller.js';
import { FileUrlService } from './services/file-url.service.js';
import { UploadsService } from './services/uploads.service.js';

@Global()
@Module({
  controllers: [UploadsController],
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig): FileStorage | null =>
        cfg.STORAGE_BUCKET === undefined ? null : new GcsFileStorage(cfg.STORAGE_BUCKET),
    },
    FileUrlService,
    UploadsService,
  ],
  exports: [FileUrlService],
})
export class FilesModule {}
