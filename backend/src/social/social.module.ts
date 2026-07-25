import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatternLikeEntity } from './entities/pattern-like.entity';
import { CreatorBlockEntity } from './entities/creator-block.entity';
import { CreatorProfileEntity } from '../creator-profile/entities/creator-profile.entity';
import { PatternEntity } from '../catalog/entities/pattern.entity';
import { PatternLikeController } from './pattern-like.controller';
import { PatternLikeService } from './pattern-like.service';
import { CreatorBlockController } from './creator-block.controller';
import { CreatorBlockService } from './creator-block.service';
import { CatalogModule } from '../catalog/catalog.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PatternLikeEntity,
      CreatorBlockEntity,
      CreatorProfileEntity,
      PatternEntity,
    ]),
    forwardRef(() => CatalogModule),
    AuthModule,
  ],
  controllers: [PatternLikeController, CreatorBlockController],
  providers: [PatternLikeService, CreatorBlockService],
  exports: [PatternLikeService, CreatorBlockService],
})
export class SocialModule {}

