import { Module } from '@nestjs/common';

import { AccountStateService } from './account-state.service';

/**
 * Account status lookups are needed by feature modules (AI Artwork, Promotion)
 * that must refuse player writes while an account is closing. Keeping the
 * service in its own module lets them depend on it without importing
 * AccountDeletionModule, which would close an import cycle.
 */
@Module({
  exports: [AccountStateService],
  providers: [AccountStateService],
})
export class AccountStateModule {}
