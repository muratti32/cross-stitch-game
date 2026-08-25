import { forwardRef, Module } from '@nestjs/common';
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
import { AdAttemptRepository } from './ad-attempt.repository';
import { AdAttemptService } from './ad-attempt.service';
import { MembershipController } from './membership.controller';
import { MembershipRepository } from './membership.repository';
import { MembershipService } from './membership.service';
import { WebhookArchiveModule } from '../webhooks';
import { EventsModule } from '../events';
import { SupportModule } from '../support/support.module';
import { CoinPackReconciliationController } from './coin-pack-reconciliation.controller';
import { CoinPackReconciliationService } from './coin-pack-reconciliation.service';
import { AiCreditPackReconciliationController } from './ai-credit-pack-reconciliation.controller';
import { AiCreditPackReconciliationService } from './ai-credit-pack-reconciliation.service';
import { CommerceCapabilitiesController } from './commerce-capabilities.controller';
import { GuestPurchaseAttemptController } from './guest-purchase-attempt.controller';
import { GuestPurchaseAttemptService } from './guest-purchase-attempt.service';
import { SubscriptionChangeReporter } from './subscription-change-reporter.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PatternEntity, PatternUnlockEntity, RegisteredAccountEntity]),
    AuthModule,
    AppConfigModule,
    forwardRef(() => PromotionModule),
    SupportModule,
    WebhookArchiveModule,
    EventsModule,
  ],
  controllers: [
    AdMobSsvController,
    EconomyController,
    DailyTaskController,
    RevenueCatWebhookController,
    MembershipController,
    CoinPackReconciliationController,
    AiCreditPackReconciliationController,
    CommerceCapabilitiesController,
    GuestPurchaseAttemptController,
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
    AdAttemptRepository,
    AdAttemptService,
    MembershipRepository,
    MembershipService,
    CoinPackReconciliationService,
    AiCreditPackReconciliationService,
    GuestPurchaseAttemptService,
    SubscriptionChangeReporter,
  ],

  exports: [
    CoinLedgerRepository,
    CommerceLedgerRepository,
    PatternUnlockService,
    RevenueCatWebhookService,
    RewardGrantService,
  ],
})
export class EconomyModule {}
