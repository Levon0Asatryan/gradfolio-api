import { Global, Module } from '@nestjs/common';
import { LOG_DESTINATION } from './index.js';

/** Provides LOG_DESTINATION: null (stdout) unless a test overrides it. */
@Global()
@Module({
  providers: [{ provide: LOG_DESTINATION, useValue: null }],
  exports: [LOG_DESTINATION],
})
export class LoggingModule {}
