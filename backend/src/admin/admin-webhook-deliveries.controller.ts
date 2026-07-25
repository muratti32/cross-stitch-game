import { BadRequestException, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import type { WebhookProcessingOutcome, WebhookProvider } from '../webhooks';
import { CurrentOperator } from './current-operator.decorator';
import { OperatorAuthGuard } from './operator-auth.guard';
import type { OperatorPrincipal } from './operator-auth.types';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';
import { WebhookDeliveriesAdminService } from './webhook-deliveries-admin.service';

const PROVIDERS: readonly WebhookProvider[] = ['revenuecat', 'admob', 'fal'];
const OUTCOMES: readonly WebhookProcessingOutcome[] = [
  'processed', 'duplicate_ignored', 'verification_failed', 'failed',
];

@Controller('admin/webhook-deliveries')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminWebhookDeliveriesController {
  constructor(private readonly deliveries: WebhookDeliveriesAdminService) {}

  @Get()
  @RequireOperatorPermissions('webhook.delivery.read')
  list(
    @Query('provider') provider?: string,
    @Query('outcome') outcome?: string,
  ) {
    return this.deliveries.list({
      outcome: parseEnum(outcome, OUTCOMES, 'outcome'),
      provider: parseEnum(provider, PROVIDERS, 'provider'),
    });
  }

  @Post(':id/replay')
  @RequireOperatorPermissions('webhook.delivery.replay')
  replay(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.deliveries.replay(id, operator.id, requestId ?? null);
  }
}

function parseEnum<T extends string>(
  value: string | undefined,
  values: readonly T[],
  name: string,
): T | undefined {
  if (value === undefined) return undefined;
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new BadRequestException(`Invalid ${name} filter`);
}
