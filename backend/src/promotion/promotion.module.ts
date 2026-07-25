import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { AppConfigModule } from '../config/app-config.module';
import { PromotionController } from './promotion.controller';
import { PromotionService } from './promotion.service';
import { PromotionLockEntity, PromotionTransferPackageEntity } from './entities';
import { CoinBalanceEntity, CoinLedgerEntryEntity } from '../economy/entities';
import { SocialModule } from '../social/social.module';
import { AccountStateModule } from '../deletion/account-state.module';

@Module({
  imports: [
    AuthModule,
    AppConfigModule,
    SocialModule,
    AccountStateModule,
    TypeOrmModule.forFeature([
      PromotionLockEntity,
      PromotionTransferPackageEntity,
      CoinBalanceEntity,
      CoinLedgerEntryEntity,
    ]),
  ],
  controllers: [PromotionController],
  providers: [PromotionService],
  exports: [PromotionService],
})
export class PromotionModule {}
