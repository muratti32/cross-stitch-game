import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InvalidatedNamespaceTokenEntity } from './entities/invalidated-namespace-token.entity';
import { InvalidatedNamespaceTokenService } from './invalidated-namespace-token.service';

@Module({
  exports: [InvalidatedNamespaceTokenService],
  imports: [
    TypeOrmModule.forFeature([InvalidatedNamespaceTokenEntity]),
  ],
  providers: [InvalidatedNamespaceTokenService],
})
export class InvalidatedNamespaceTokenModule {}
