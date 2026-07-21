import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { PatternEntity } from '../catalog/entities';
import { CoinLedgerRepository, InsufficientCoinError } from './coin-ledger.repository';

/**
 * Handles server-side check and spend actions to unlock patterns.
 * Governed by Stitch Coin economy rules in ADR-0011.
 */
@Injectable()
export class PatternUnlockService {
  constructor(
    private readonly ledger: CoinLedgerRepository,
    @InjectRepository(PatternEntity)
    private readonly patternRepo: Repository<PatternEntity>,
  ) {}

  async unlock(
    principal: AuthPrincipal,
    patternId: string,
  ): Promise<{ patternId: string; alreadyUnlocked: boolean; balance: number }> {
    const pattern = await this.patternRepo.findOne({ where: { id: patternId } });
    if (!pattern) {
      throw new NotFoundException('Pattern not found');
    }
    if (pattern.status !== 'available') {
      throw new ConflictException('Pattern is not available');
    }
    if (pattern.visibility !== 'catalog') {
      throw new NotFoundException('Pattern not found');
    }
    if (pattern.unlockPriceTier === null) {
      throw new BadRequestException({ code: 'pattern_free' });
    }

    const ledgerPrincipal = {
      type: principal.type === PrincipalType.Account ? ('account' as const) : ('guest' as const),
      id: principal.id,
    };

    try {
      const result = await this.ledger.spendPatternUnlock(
        ledgerPrincipal,
        patternId,
        pattern.unlockPriceTier,
      );
      return {
        patternId,
        alreadyUnlocked: result.alreadyUnlocked,
        balance: result.balance,
      };
    } catch (e) {
      if (e instanceof InsufficientCoinError) {
        throw new ConflictException({
          code: 'insufficient_balance',
          price: e.price,
          balance: e.balance,
        });
      }
      throw e;
    }
  }

  async listUnlocks(
    principal: AuthPrincipal,
  ): Promise<{ patternIds: string[] }> {
    const ledgerPrincipal = {
      type: principal.type === PrincipalType.Account ? ('account' as const) : ('guest' as const),
      id: principal.id,
    };
    const patternIds = await this.ledger.listUnlockedPatternIds(ledgerPrincipal);
    return { patternIds };
  }
}
