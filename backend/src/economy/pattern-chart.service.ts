import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { PatternEntity } from '../catalog/entities';
import { stitchableCells } from '../catalog/stitchable-cells';
import { AppConfigService } from '../config/app-config.service';
import { PromotionService } from '../promotion/promotion.service';
import { buildArtifactGrant } from '../sessions/artifact-grant';
import { InsufficientCoinError } from './coin-ledger.repository';
import { patternChartPrice, patternChartTier, unlockPrice, type PatternChartTier } from './economy.constants';
import { PatternChartRepository } from './pattern-chart.repository';

export interface PatternChartPurchaseResult {
  patternId: string;
  alreadyEntitled: boolean;
  price: number;
  /** Server-owned price tier, so the app never infers it back from the price. */
  tier: PatternChartTier;
  balance: number;
}

export interface PatternChartView {
  patternId: string;
  entitled: boolean;
  price: number;
  tier: PatternChartTier;
  /** Lets the app hide Buy under Catalog Withdrawal and never draw under Safety Removal. */
  status: PatternEntity['status'];
}

/**
 * Pattern Chart Entitlement purchase and artifact access for Registered
 * Accounts and Official Patterns (ADR-0068, #287).
 */
@Injectable()
export class PatternChartService {
  constructor(
    private readonly repository: PatternChartRepository,
    @InjectRepository(PatternEntity)
    private readonly patternRepo: Repository<PatternEntity>,
    private readonly promotionService: PromotionService,
    private readonly configService: AppConfigService,
  ) {}

  async view(principal: AuthPrincipal, patternId: string): Promise<PatternChartView> {
    this.assertAccount(principal);
    const pattern = await this.loadOfficialPattern(patternId);
    const cells = stitchableCells(pattern);
    return {
      patternId,
      entitled: await this.repository.isEntitled(principal.id, patternId),
      price: patternChartPrice(cells),
      tier: patternChartTier(cells),
      status: pattern.status,
    };
  }

  async purchase(
    principal: AuthPrincipal,
    patternId: string,
    expectedPrice: number,
  ): Promise<PatternChartPurchaseResult> {
    this.assertAccount(principal);
    await this.promotionService.assertNotLocked(principal.id, principal.type);
    const pattern = await this.loadOfficialPattern(patternId);

    const cells = stitchableCells(pattern);
    const price = patternChartPrice(cells);
    const tier = patternChartTier(cells);

    // An existing entitlement answers `alreadyEntitled` even after withdrawal; only a new sale needs `available`.
    if (!(await this.repository.isEntitled(principal.id, patternId))) {
      this.assertAvailable(pattern);
      await this.assertCanStart(principal.id, pattern);
      if (expectedPrice !== price) {
        throw new ConflictException({ code: 'pattern_chart_price_changed', price });
      }
    }

    try {
      const result = await this.repository.spend(principal.id, patternId, price, tier);
      return { patternId, ...result, tier };
    } catch (error) {
      if (error instanceof InsufficientCoinError) {
        throw new ConflictException({
          code: 'insufficient_balance',
          price: error.price,
          balance: error.balance,
        });
      }
      throw error;
    }
  }

  /** Signed Pattern Artifact grant for an entitled account; creates no Stitching Session. */
  async artifactGrant(principal: AuthPrincipal, patternId: string) {
    this.assertAccount(principal);
    const pattern = await this.loadOfficialPattern(patternId);
    if (!(await this.repository.isEntitled(principal.id, patternId))) {
      throw new ForbiddenException({ code: 'pattern_chart_required', patternId });
    }
    this.assertAvailable(pattern);
    return buildArtifactGrant(
      this.configService.grantSigningSecret,
      this.configService.grantTtlSeconds,
      pattern,
    );
  }

  private assertAccount(principal: AuthPrincipal): void {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException({ code: 'account_required' });
    }
  }

  private async loadOfficialPattern(patternId: string): Promise<PatternEntity> {
    const pattern = await this.patternRepo.findOne({ where: { id: patternId } });
    if (!pattern || pattern.visibility !== 'catalog' || pattern.creatorProfileId !== null) {
      throw new NotFoundException('Pattern not found');
    }
    return pattern;
  }

  /** Catalog Withdrawal and Safety Removal stop new purchases and fetches. */
  private assertAvailable(pattern: PatternEntity): void {
    if (pattern.status === 'available') return;
    throw new GoneException({
      code: pattern.status === 'removed' ? 'pattern_removed' : 'pattern_unavailable',
    });
  }

  private async assertCanStart(accountId: string, pattern: PatternEntity): Promise<void> {
    if (pattern.unlockPriceTier === null) return;
    if (await this.repository.isPatternUnlocked(accountId, pattern.id)) return;
    throw new ForbiddenException({
      code: 'unlock_required',
      patternId: pattern.id,
      price: unlockPrice(pattern.unlockPriceTier),
    });
  }
}
