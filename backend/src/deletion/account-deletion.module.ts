import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountStateModule } from './account-state.module';
import { AccountClosureWorkloadService } from './account-closure-workload.service';
import { AccountDeletionFinalizerService } from './account-deletion-finalizer.service';
import { AccountWriteFreezeInterceptor } from './account-write-freeze.interceptor';
import {
  AccountDeletionRequestEntity,
  DeletionAuditEventEntity,
} from './entities';

@Module({
  controllers: [AccountDeletionController],
  exports: [
    AccountDeletionService,
    AccountStateModule,
    AccountClosureWorkloadService,
    AccountDeletionFinalizerService,
  ],
  imports: [
    AccountStateModule,
    AuthModule,
    CatalogModule,
    TypeOrmModule.forFeature([
      AccountDeletionRequestEntity,
      DeletionAuditEventEntity,
    ]),
  ],
  providers: [
    AccountDeletionService,
    AccountClosureWorkloadService,
    AccountDeletionFinalizerService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AccountWriteFreezeInterceptor,
    },
  ],
})
export class AccountDeletionModule {}
