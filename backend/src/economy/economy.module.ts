import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { AppConfigModule } from '../config/app-config.module';
import { PatternEntity } from '../catalog/entities';
import { AdMobSsvController } from './admob-ssv.controller';
import { AdMobSsvVerifierService } from './admob-ssv-verifier.service';
import { CoinLedgerRepository } from './coin-ledger.repository';
import { EconomyController } from './economy.controller';
import { EconomyReadService } from './economy-read.service';
import { RewardGrantService } from './reward-grant.service';
import { PatternUnlockService } from './pattern-unlock.service';
import { PatternUnlockEntity } from './entities';
import { DailyTaskController } from './daily-task.controller';
import { DailyTaskService } from './daily-task.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PatternEntity, PatternUnlockEntity]),
    AuthModule,
    AppConfigModule,
  ],
  controllers: [AdMobSsvController, EconomyController, DailyTaskController],
  providers: [
    CoinLedgerRepository,
    AdMobSsvVerifierService,
    RewardGrantService,
    EconomyReadService,
    PatternUnlockService,
    DailyTaskService,
  ],
  exports: [CoinLedgerRepository, PatternUnlockService],
})
export class EconomyModule {}
