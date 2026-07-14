import { Module } from '@nestjs/common';

import { EmailAuthModule } from './email-auth.module';
import { EmailAuthWorkerRuntimeService } from './email-auth-worker-runtime.service';

@Module({
  exports: [EmailAuthWorkerRuntimeService],
  imports: [EmailAuthModule],
  providers: [EmailAuthWorkerRuntimeService],
})
export class EmailAuthWorkerModule {}
