import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { resolveCommerceProduct } from '../economy/commerce.constants';
import { AppConfigService } from '../config/app-config.service';
import { StorageReconcilerService } from '../sessions/storage-reconciler.service';
import {
  ReconciliationFindingClass,
  ReconciliationFindingEntity,
  ReconciliationRunEntity,
} from './entities';

const SCRUBBED_MARKER = '[Scrubbed]';

interface ArchivedDeliveryRow {
  payload: Record<string, unknown>;
}

interface CommerceLedgerRow {
  source_key: string;
}

interface StuckReservationRow {
  id: string;
  processing_job_id: string;
  job_status: string | null;
}

interface PendingFinding {
  findingClass: ReconciliationFindingClass;
  identifier: string;
  relatedIdentifier: string | null;
  detail: string | null;
}

interface CommerceDelivery {
  environment: 'sandbox' | 'production';
  source: 'commerce' | 'reversal';
  transactionId: string;
}

export interface ReconciliationRunResult {
  runId: string;
  ranAt: Date;
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storageReconciler: StorageReconcilerService,
    private readonly config: AppConfigService,
    @InjectRepository(ReconciliationRunEntity)
    private readonly runs: Repository<ReconciliationRunEntity>,
    @InjectRepository(ReconciliationFindingEntity)
    private readonly findings: Repository<ReconciliationFindingEntity>,
  ) {}

  async reconcileOnce(now = new Date()): Promise<ReconciliationRunResult> {
    const commerceWindowStart = new Date(
      now.getTime() - this.config.webhookArchiveRetentionSeconds * 1000,
    );
    const reservationCutoff = new Date(
      now.getTime() - this.config.aiCreditReservationStalenessSeconds * 1000,
    );
    const [commerceFindings, storageFindings, reservationFindings] = await Promise.all([
      this.findCommerceDiscrepancies(commerceWindowStart),
      this.findStorageDiscrepancies(),
      this.findStuckReservations(reservationCutoff),
    ]);
    const pendingFindings = [
      ...commerceFindings,
      ...storageFindings,
      ...reservationFindings,
    ];
    const run = await this.dataSource.transaction(async (manager) => {
      const savedRun = await manager.getRepository(ReconciliationRunEntity).save(
        this.runs.create({
          aiCreditReservationStuckCount: reservationFindings.length,
          commerceDeliveryWithoutLedgerCount: countFindings(
            commerceFindings,
            'commerce_delivery_without_ledger',
          ),
          commerceLedgerWithoutDeliveryCount: countFindings(
            commerceFindings,
            'commerce_ledger_without_delivery',
          ),
          commerceWindowStart,
          storageOrphanObjectCount: countFindings(
            storageFindings,
            'storage_orphan_object',
          ),
          storageRegistryMissingObjectCount: countFindings(
            storageFindings,
            'storage_registry_missing_object',
          ),
        }),
      );
      if (pendingFindings.length > 0) {
        await manager.getRepository(ReconciliationFindingEntity).save(
          pendingFindings.map((finding) =>
            this.findings.create({ ...finding, runId: savedRun.id }),
          ),
        );
      }
      return savedRun;
    });

    return { ranAt: run.ranAt, runId: run.id };
  }

  private async findCommerceDiscrepancies(
    commerceWindowStart: Date,
  ): Promise<readonly PendingFinding[]> {
    const [archiveRows, ledgerRows] = await Promise.all([
      this.dataSource.query<ArchivedDeliveryRow[]>(
        `SELECT payload
         FROM observability.webhook_delivery_archives
         WHERE provider = 'revenuecat'
           AND verification_result = 'verified'
           AND processing_outcome = 'processed'
           AND received_at >= $1`,
        [commerceWindowStart],
      ),
      this.dataSource.query<CommerceLedgerRow[]>(
        `SELECT source_key
         FROM economy.coin_ledger_entries
         WHERE created_at >= $1
           AND (source_key LIKE 'commerce:%' OR source_key LIKE 'reversal:%')
         UNION ALL
         SELECT source_key
         FROM economy.ai_credit_ledger_entries
         WHERE created_at >= $1
           AND (source_key LIKE 'commerce:%' OR source_key LIKE 'reversal:%')`,
        [commerceWindowStart],
      ),
    ]);
    const deliveries = [...new Map(archiveRows
      .map((row) => commerceDeliveryFromArchive(row.payload))
      .filter((delivery): delivery is CommerceDelivery => delivery !== null)
      .map((delivery) => [commerceKey(delivery), delivery] as const)).values()];
    const deliveryKeys = new Set(deliveries.map(commerceKey));
    const ledgerEntries = ledgerRows
      .map((row) => commerceLedgerFromSourceKey(row.source_key))
      .filter((entry): entry is CommerceDelivery => entry !== null);
    const ledgerKeys = new Set(ledgerEntries.map(commerceKey));

    return [
      ...deliveries
        .filter((delivery) => !ledgerKeys.has(commerceKey(delivery)))
        .map((delivery) => ({
          detail: `${delivery.source}:${delivery.environment}`,
          findingClass: 'commerce_delivery_without_ledger' as const,
          identifier: delivery.transactionId,
          relatedIdentifier: null,
        })),
      ...ledgerEntries
        .filter((entry) => !deliveryKeys.has(commerceKey(entry)))
        .map((entry) => ({
          detail: `${entry.source}:${entry.environment}`,
          findingClass: 'commerce_ledger_without_delivery' as const,
          identifier: entry.transactionId,
          relatedIdentifier: null,
        })),
    ];
  }

  private async findStorageDiscrepancies(): Promise<readonly PendingFinding[]> {
    const discrepancies = await this.storageReconciler.reportDiscrepancies();
    return [
      ...discrepancies.registryMissingObjectKeys.map((objectKey) => ({
        detail: null,
        findingClass: 'storage_registry_missing_object' as const,
        identifier: objectKey,
        relatedIdentifier: null,
      })),
      ...discrepancies.storageOrphanObjectKeys.map((objectKey) => ({
        detail: null,
        findingClass: 'storage_orphan_object' as const,
        identifier: objectKey,
        relatedIdentifier: null,
      })),
    ];
  }

  private async findStuckReservations(
    reservationCutoff: Date,
  ): Promise<readonly PendingFinding[]> {
    const rows = await this.dataSource.query<StuckReservationRow[]>(
      `SELECT reservation.id, reservation.processing_job_id, job.status AS job_status
       FROM ai.ai_credit_reservations reservation
       LEFT JOIN jobs.processing_jobs job ON job.id = reservation.processing_job_id
       WHERE reservation.status = 'reserved'
         AND reservation.created_at < $1`,
      [reservationCutoff],
    );
    return rows.map((row) => ({
      detail: row.job_status,
      findingClass: 'ai_credit_reservation_stuck' as const,
      identifier: row.id,
      relatedIdentifier: row.processing_job_id,
    }));
  }
}

function commerceDeliveryFromArchive(
  payload: Record<string, unknown>,
): CommerceDelivery | null {
  const event = payload.event;
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return null;
  }
  const fields = event as Record<string, unknown>;
  if (typeof fields.transaction_id !== 'string' || typeof fields.environment !== 'string') {
    return null;
  }
  // The archive stores payloads through the shared ADR-0035 scrubber, which can
  // redact an identifier that looks like an opaque secret. A redacted id cannot
  // be matched against the ledger, so skip it rather than reporting a phantom
  // delivery-without-ledger finding an operator could never chase.
  if (fields.transaction_id.includes(SCRUBBED_MARKER)) {
    return null;
  }
  const environment = fields.environment.toLowerCase();
  if (environment !== 'sandbox' && environment !== 'production') {
    return null;
  }
  if (
    fields.type === 'NON_RENEWING_PURCHASE' &&
    typeof fields.product_id === 'string' &&
    resolveCommerceProduct(fields.product_id) !== null
  ) {
    return { environment, source: 'commerce', transactionId: fields.transaction_id };
  }
  if (
    (fields.type === 'REFUND' ||
      (fields.type === 'CANCELLATION' && fields.cancel_reason === 'CUSTOMER_SUPPORT')) &&
    typeof fields.product_id === 'string' &&
    resolveCommerceProduct(fields.product_id) !== null
  ) {
    return { environment, source: 'reversal', transactionId: fields.transaction_id };
  }
  return null;
}

function commerceKey(delivery: CommerceDelivery): string {
  return `${delivery.source}:${delivery.environment}:${delivery.transactionId}`;
}

function commerceLedgerFromSourceKey(sourceKey: string): CommerceDelivery | null {
  const [source, environment, ...transactionIdParts] = sourceKey.split(':');
  const transactionId = transactionIdParts.join(':');
  if (
    (source !== 'commerce' && source !== 'reversal') ||
    (environment !== 'sandbox' && environment !== 'production') ||
    transactionId.length === 0
  ) {
    return null;
  }
  return { environment, source, transactionId };
}

function countFindings(
  findings: readonly PendingFinding[],
  findingClass: ReconciliationFindingClass,
): number {
  return findings.filter((finding) => finding.findingClass === findingClass).length;
}
