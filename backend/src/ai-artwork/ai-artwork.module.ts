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
@Module({ imports: [TypeOrmModule.forFeature([AiArtworkEntity, AiCreditReservationEntity]), AuthModule, AccountStateModule, forwardRef(() => CatalogModule), SupportModule, forwardRef(() => JobsModule), forwardRef(() => ConversionModule)], controllers: [AiArtworkController], providers: [AiArtworkService, AiArtworkJobConsumerService, PromptModerationService, FalArtworkProviderService], exports: [AiArtworkJobConsumerService, AiArtworkService] })
export class AiArtworkModule {}
