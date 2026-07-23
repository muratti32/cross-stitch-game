import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RegisteredAccountEntity, RegisteredAccountStatus } from '../auth/entities';
import { CommerceLedgerRepository } from './commerce-ledger.repository';

export interface RevenueCatWebhookOutcome {
  handled: boolean; // false for event types this ticket doesn't own
  detail: string; // short machine-readable reason for logging
}

@Injectable()
export class RevenueCatWebhookService {
  private readonly logger = new Logger(RevenueCatWebhookService.name);

  constructor(
    private readonly commerceLedger: CommerceLedgerRepository,
    @InjectRepository(RegisteredAccountEntity)
    private readonly accounts: Repository<RegisteredAccountEntity>,
  ) {}

  async handleEvent(body: unknown): Promise<RevenueCatWebhookOutcome> {
    if (body === null || typeof body !== 'object') {
      throw new BadRequestException('Invalid webhook body shape');
    }

    const envelope = body as Record<string, unknown>;
    const event = envelope.event;
    if (event === null || typeof event !== 'object') {
      throw new BadRequestException('Webhook body is missing event object');
    }

    const evt = event as Record<string, unknown>;

    // Validate required event fields defensively
    const requiredFields = ['type', 'app_user_id', 'transaction_id', 'product_id', 'environment'];
    for (const field of requiredFields) {
      if (typeof evt[field] !== 'string' || (evt[field] as string).trim().length === 0) {
        throw new BadRequestException(`Event is missing or has invalid field: ${field}`);
      }
    }

    const type = evt.type as string;
    const appUserId = evt.app_user_id as string;
    const transactionId = evt.transaction_id as string;
    const productId = evt.product_id as string;
    const rawEnv = evt.environment as string;

    if (rawEnv !== 'SANDBOX' && rawEnv !== 'PRODUCTION') {
      throw new BadRequestException(`Invalid event environment value: ${rawEnv}`);
    }

    const environment = rawEnv.toLowerCase() as 'sandbox' | 'production';

    if (type === 'NON_RENEWING_PURCHASE') {
      const account = await this.accounts.findOne({ where: { id: appUserId } });
      if (!account || account.status !== RegisteredAccountStatus.Active) {
        this.logger.warn(
          `RevenueCat webhook NON_RENEWING_PURCHASE rejected: account ${appUserId} does not exist or is inactive`,
        );
        return { handled: false, detail: 'unknown_or_inactive_account' };
      }

      const result = await this.commerceLedger.processPurchase({
        environment,
        providerTransactionId: transactionId,
        accountId: appUserId,
        productId,
      });

      if (result.outcome === 'rejected_other_account') {
        this.logger.warn(
          `RevenueCat webhook NON_RENEWING_PURCHASE fraud signal: transaction ${transactionId} already bound to a different account (claimed by ${appUserId})`,
        );
      } else {
        this.logger.log(
          `RevenueCat webhook NON_RENEWING_PURCHASE transaction ${transactionId}: outcome=${result.outcome} currency=${result.currency} amount=${result.amount} balance=${result.balance}`,
        );
      }

      return {
        handled: true,
        detail: result.outcome,
      };
    }

    if (type === 'REFUND') {
      const result = await this.commerceLedger.processReversal({
        environment,
        providerTransactionId: transactionId,
      });

      this.logger.log(
        `RevenueCat webhook REFUND transaction ${transactionId}: applied=${result.applied} currency=${result.currency} amount=${result.amount} balance=${result.balance}`,
      );

      return {
        handled: true,
        detail: result.applied ? 'reversed' : 'no_binding_to_reverse',
      };
    }

    this.logger.debug(`RevenueCat webhook ignored event type: ${type}`);
    return {
      handled: false,
      detail: 'ignored_event_type',
    };
  }
}
