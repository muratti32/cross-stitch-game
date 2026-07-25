import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { WebhookDeliveryArchiveEntity } from './webhook-delivery-archive.entity';
import { WebhookDeliveryArchiveService } from './webhook-delivery-archive.service';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookDeliveryArchiveEntity])],
  providers: [WebhookDeliveryArchiveService],
  exports: [WebhookDeliveryArchiveService, TypeOrmModule],
})
export class WebhookArchiveModule {}
