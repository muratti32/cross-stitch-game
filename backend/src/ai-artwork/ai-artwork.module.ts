import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ConversionModule } from '../conversion/conversion.module';
import { JobsModule } from '../jobs/jobs.module';
import { AccountStateModule } from '../deletion/account-state.module';
import { AiArtworkController } from './ai-artwork.controller';
import { AiArtworkJobConsumerService } from './ai-artwork-job-consumer.service';
import { AiArtworkService } from './ai-artwork.service';
import { FalArtworkProviderService } from './fal-artwork-provider.service';
import { AiArtworkEntity, AiCreditReservationEntity } from './entities';
import { PromptModerationService } from './prompt-moderation.service';
import { SupportModule } from '../support/support.module';
import { AppConfigModule } from '../config/app-config.module';
import { WebhookArchiveModule } from '../webhooks';
@Module({ imports: [TypeOrmModule.forFeature([AiArtworkEntity, AiCreditReservationEntity]), AuthModule, AppConfigModule, AccountStateModule, forwardRef(() => CatalogModule), SupportModule, WebhookArchiveModule, forwardRef(() => JobsModule), forwardRef(() => ConversionModule)], controllers: [AiArtworkController], providers: [AiArtworkService, AiArtworkJobConsumerService, PromptModerationService, FalArtworkProviderService], exports: [AiArtworkJobConsumerService, AiArtworkService] })
export class AiArtworkModule {}
