import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SupportReferenceEntity, SupportReferenceRecordEntity } from './entities';
import { SupportReferenceService } from './support-reference.service';

@Module({
  exports: [SupportReferenceService],
  imports: [TypeOrmModule.forFeature([SupportReferenceEntity, SupportReferenceRecordEntity])],
  providers: [SupportReferenceService],
})
export class SupportModule {}
