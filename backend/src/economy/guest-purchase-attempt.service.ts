import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { randomUUID } from 'node:crypto';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { AppConfigService } from '../config/app-config.service';
import { SupportReferenceService } from '../support/support-reference.service';
import { CommerceLedgerRepository } from './commerce-ledger.repository';
import { GUEST_COIN_PACK_PRODUCT_IDS, type GuestPurchaseAttemptDto } from './guest-purchase-attempt.dto';
import { assertIosGuestCommerceClientHint } from './commerce-capabilities';

interface AttemptRow {
  id: string;
  principal_id: string;
  product_id: string;
  idempotency_key: string;
  subscriber_id: string;
  status: 'created' | 'verifying' | 'granted' | 'failed' | 'cancelled';
  provider_transaction_id: string | null;
  support_reference_id: string;
}

@Injectable()
export class GuestPurchaseAttemptService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly supportReferences: SupportReferenceService,
    private readonly commerceLedger: CommerceLedgerRepository,
    private readonly config: AppConfigService,
  ) {}

  async mapSubscriber(principal: AuthPrincipal, subscriberId: string, userAgent?: string): Promise<{ mapped: true }> {
    this.requireGuest(principal);
    this.requireIosGuestCommerce(userAgent);
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.query<readonly { guest_installation_id: string }[]>(
        `SELECT guest_installation_id FROM economy.revenuecat_subscriber_mappings WHERE subscriber_id = $1 FOR UPDATE`,
        [subscriberId],
      );
      if (existing[0] !== undefined && existing[0].guest_installation_id !== principal.id) {
        throw new ConflictException('RevenueCat subscriber is already mapped');
      }
      await manager.query(
        `INSERT INTO economy.revenuecat_subscriber_mappings (subscriber_id, guest_installation_id)
         VALUES ($1, $2)
         ON CONFLICT (subscriber_id) DO UPDATE SET updated_at = now()`,
        [subscriberId, principal.id],
      );
      return { mapped: true };
    });
  }

  async start(principal: AuthPrincipal, input: GuestPurchaseAttemptDto, userAgent?: string) {
    this.requireGuest(principal);
    this.requireIosGuestCommerce(userAgent);
    if (!GUEST_COIN_PACK_PRODUCT_IDS.includes(input.productId)) {
      throw new ForbiddenException('Guest commerce supports Stitch Coin Packs only');
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
      const mapping = await manager.query<readonly { guest_installation_id: string }[]>(
        `SELECT guest_installation_id FROM economy.revenuecat_subscriber_mappings WHERE subscriber_id = $1`,
        [input.subscriberId],
      );
      if (mapping[0]?.guest_installation_id !== principal.id) {
        throw new ForbiddenException('RevenueCat subscriber is not mapped to this Guest Installation Identity');
      }
      const existing = await manager.query<readonly AttemptRow[]>(
        `SELECT * FROM economy.purchase_attempts
         WHERE principal_type = 'guest' AND principal_id = $1 AND product_id = $2
            AND status IN ('created', 'verifying')
         FOR UPDATE`,
        [principal.id, input.productId],
      );
      if (existing[0] !== undefined && existing[0].idempotency_key !== input.idempotencyKey) {
        throw new ConflictException('A purchase for this Stitch Coin Pack is already being verified');
      }
      const byKey = await manager.query<readonly AttemptRow[]>(
        `SELECT * FROM economy.purchase_attempts WHERE principal_type = 'guest' AND principal_id = $1 AND idempotency_key = $2`,
        [principal.id, input.idempotencyKey],
      );
      if (byKey[0] !== undefined) return this.response(byKey[0], await this.supportCode(manager, byKey[0].support_reference_id));

      const id = randomUUID();
      const supportReference = await this.supportReferences.create(manager, {
        principalType: 'guest', principalId: principal.id,
        records: [{ type: 'guest_purchase_attempt', id }],
      });
      const references = await manager.query<readonly { id: string }[]>(
        `SELECT id FROM support.support_references WHERE code = $1`, [supportReference],
      );
      const reference = references[0];
      if (reference === undefined) throw new Error('Support Reference was not persisted');
      const rows = await manager.query<readonly AttemptRow[]>(
        `INSERT INTO economy.purchase_attempts
          (id, principal_type, principal_id, product_id, idempotency_key, subscriber_id, support_reference_id)
         VALUES ($1, 'guest', $2, $3, $4, $5, $6) RETURNING *`,
        [id, principal.id, input.productId, input.idempotencyKey, input.subscriberId, reference.id],
      );
      const attempt = rows[0];
      if (attempt === undefined) throw new Error('Purchase Attempt was not created');
      return this.response(attempt, supportReference);
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A purchase for this Stitch Coin Pack is already being verified');
      }
      throw error;
    }
  }

  async status(principal: AuthPrincipal, id: string) {
    this.requireGuest(principal);
    const rows = await this.dataSource.query<readonly AttemptRow[]>(
      `SELECT * FROM economy.purchase_attempts WHERE id = $1 AND principal_type = 'guest' AND principal_id = $2`,
      [id, principal.id],
    );
    const attempt = rows[0];
    if (attempt === undefined) throw new NotFoundException('Purchase Attempt was not found');
    const supportReference = await this.supportReferences.findCodeForRecord('guest_purchase_attempt', id);
    return this.response(attempt, supportReference ?? '');
  }

  async resolveSubscriber(subscriberId: string): Promise<string | null> {
    const rows = await this.dataSource.query<readonly { guest_installation_id: string }[]>(
      `SELECT guest_installation_id FROM economy.revenuecat_subscriber_mappings WHERE subscriber_id = $1`, [subscriberId],
    );
    return rows[0]?.guest_installation_id ?? null;
  }

  async applyWebhook(subscriberIds: string | readonly string[], productId: string, environment: 'sandbox' | 'production', transactionId: string) {
    const ids = [...new Set(typeof subscriberIds === 'string' ? [subscriberIds] : subscriberIds)];
    const guestIds = await Promise.all(ids.map((id) => this.resolveSubscriber(id)));
    const guestId = guestIds.find((id): id is string => id !== null) ?? null;
    if (guestId === null) return null;
    if (guestIds.some((id) => id !== null && id !== guestId)) {
      return { handled: false, detail: 'guest_subscriber_alias_conflict', duplicate: false };
    }
    await this.dataSource.query(
      `INSERT INTO economy.revenuecat_subscriber_mappings (subscriber_id, guest_installation_id)
       SELECT value, $1 FROM unnest($2::varchar[]) AS value
       ON CONFLICT (subscriber_id) DO UPDATE SET updated_at = now()`,
      [guestId, ids],
    );
    const placeholders = ids.map((_, index) => `$${index + 2}`).join(', ');
    const rows = await this.dataSource.query<readonly AttemptRow[]>(
      `SELECT * FROM economy.purchase_attempts
       WHERE principal_type = 'guest' AND principal_id = $1 AND subscriber_id IN (${placeholders}) AND product_id = $${ids.length + 2}
         AND (status IN ('created', 'verifying') OR (status = 'granted' AND provider_transaction_id = $${ids.length + 3}))
       ORDER BY CASE WHEN status IN ('created', 'verifying') THEN 0 ELSE 1 END`,
      [guestId, ...ids, productId, transactionId],
    );
    const attempt = rows[0];
    if (attempt === undefined) return null;
    if (attempt.status === 'granted') {
      return { handled: true, detail: 'replayed_same_guest', duplicate: true };
    }
    await this.dataSource.query(`UPDATE economy.purchase_attempts SET status = 'verifying', provider_transaction_id = $2, updated_at = now() WHERE id = $1`, [attempt.id, transactionId]);
    const result = await this.commerceLedger.processPurchase({ environment, providerTransactionId: transactionId, owner: { type: 'guest', guestInstallationId: guestId }, productId });
    await this.dataSource.query(`UPDATE economy.purchase_attempts SET status = $2, updated_at = now() WHERE id = $1`, [attempt.id, result.outcome === 'granted' || result.outcome === 'replayed_same_account' ? 'granted' : 'failed']);
    return { handled: true, detail: result.outcome, duplicate: result.outcome === 'replayed_same_account' };
  }

  private response(attempt: AttemptRow, supportReference: string) {
    return { id: attempt.id, status: attempt.status, productId: attempt.product_id, supportReference, providerTransactionId: attempt.provider_transaction_id };
  }

  private async supportCode(manager: Parameters<SupportReferenceService['create']>[0], id: string) {
    const rows = await manager.query<readonly { code: string }[]>(`SELECT code FROM support.support_references WHERE id = $1`, [id]);
    return rows[0]?.code ?? '';
  }

  private requireGuest(principal: AuthPrincipal): void {
    if (principal.type !== PrincipalType.Guest) throw new ForbiddenException('A Guest Installation Identity is required');
  }

  private requireIosGuestCommerce(userAgent: string | undefined): void {
    if (!this.config.iosGuestCommerceEnabled) {
      throw new ForbiddenException(
        'Guest commerce is disabled; retry after ENABLE_IOS_GUEST_COMMERCE is enabled',
      );
    }
    try { assertIosGuestCommerceClientHint(userAgent); } catch (error: unknown) {
      throw new ForbiddenException(error instanceof Error ? error.message : 'Guest commerce is unavailable');
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError) || typeof error.driverError !== 'object' || error.driverError === null) {
    return false;
  }
  const driverError = error.driverError as unknown as Record<string, unknown>;
  return driverError.code === '23505';
}
