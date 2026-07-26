import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CatalogWithdrawalService } from './catalog-withdrawal.service';

@Controller('catalog/patterns')
@UseGuards(JwtAuthGuard)
export class CatalogWithdrawalController {
  constructor(private readonly withdrawals: CatalogWithdrawalService) {}

  @Post(':patternId/withdraw')
  withdraw(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    return this.withdrawals.withdraw(principal, patternId);
  }
}
