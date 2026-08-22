import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { GuestPurchaseAttemptDto, GuestSubscriberMappingDto } from './guest-purchase-attempt.dto';
import { GuestPurchaseAttemptService } from './guest-purchase-attempt.service';

@Controller('commerce/guest')
@UseGuards(JwtAuthGuard)
export class GuestPurchaseAttemptController {
  constructor(private readonly attempts: GuestPurchaseAttemptService) {}

  @Post('revenuecat-mapping')
  map(@CurrentPrincipal() principal: AuthPrincipal, @Headers('user-agent') userAgent: string | undefined, @Body() body: GuestSubscriberMappingDto) {
    return this.attempts.mapSubscriber(principal, body.subscriberId, userAgent);
  }

  @Post('purchase-attempts')
  start(@CurrentPrincipal() principal: AuthPrincipal, @Headers('user-agent') userAgent: string | undefined, @Body() body: GuestPurchaseAttemptDto) {
    return this.attempts.start(principal, body, userAgent);
  }

  @Get('purchase-attempts/:id')
  status(@CurrentPrincipal() principal: AuthPrincipal, @Param('id') id: string) {
    return this.attempts.status(principal, id);
  }
}
