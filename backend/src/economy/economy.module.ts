import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RegisteredAccountEntity } from '../auth/entities';
import { AppConfigModule } from '../config/app-config.module';
import { PatternEntity } from '../catalog/entities';
import { PromotionModule } from '../promotion/promotion.module';
import { AdMobSsvController } from './admob-ssv.controller';
import { AdMobSsvVerifierService } from './admob-ssv-verifier.service';
import { CoinLedgerRepository } from './coin-ledger.repository';
import { CommerceLedgerRepository } from './commerce-ledger.repository';
import { EconomyController } from './economy.controller';
import { EconomyReadService } from './economy-read.service';
import { RewardGrantService } from './reward-grant.service';
import { PatternUnlockService } from './pattern-unlock.service';
import { PatternUnlockEntity } from './entities';
import { DailyTaskController } from './daily-task.controller';
import { DailyTaskService } from './daily-task.service';
import { RevenueCatWebhookController } from './revenuecat-webhook.controller';
import { RevenueCatWebhookVerifierService } from './revenuecat-webhook-verifier.service';
import { RevenueCatWebhookService } from './revenuecat-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PatternEntity, PatternUnlockEntity, RegisteredAccountEntity]),
    AuthModule,
    AppConfigModule,
    PromotionModule,
  ],
  controllers: [
    AdMobSsvController,
    EconomyController,
    DailyTaskController,
    RevenueCatWebhookController,
  ],
  providers: [
    CoinLedgerRepository,
    CommerceLedgerRepository,
    AdMobSsvVerifierService,
    RewardGrantService,
    EconomyReadService,
    PatternUnlockService,
    DailyTaskService,
    RevenueCatWebhookVerifierService,
    RevenueCatWebhookService,
  ],

  exports: [
    CoinLedgerRepository,
    CommerceLedgerRepository,
    PatternUnlockService,
  ],
})
export class EconomyModule {}
