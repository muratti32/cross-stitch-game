import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AppConfigModule } from '../config/app-config.module';
import { AdMobSsvController } from './admob-ssv.controller';
import { AdMobSsvVerifierService } from './admob-ssv-verifier.service';
import { CoinLedgerRepository } from './coin-ledger.repository';
import { EconomyController } from './economy.controller';
import { EconomyReadService } from './economy-read.service';
import { RewardGrantService } from './reward-grant.service';

@Module({
  imports: [AuthModule, AppConfigModule],
  controllers: [AdMobSsvController, EconomyController],
  providers: [
    CoinLedgerRepository,
    AdMobSsvVerifierService,
    RewardGrantService,
    EconomyReadService,
  ],
  exports: [CoinLedgerRepository],
})
export class EconomyModule {}
