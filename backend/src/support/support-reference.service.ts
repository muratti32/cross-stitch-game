import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { returningRows } from '../database/query-results';
import {
  SupportPrincipalType,
  SupportRecordType,
  SupportReferenceEntity,
  SupportReferenceRecordEntity,
} from './entities';
import {
  generateSupportReferenceCode,
  normalizeSupportReferenceCode,
} from './support-reference-code';

export interface SupportRecordRef {
  type: SupportRecordType;
  id: string;
}

export interface ResolvedSupportRecord extends SupportRecordRef {
  data: Record<string, unknown> | null;
}

export interface ResolvedSupportReference {
  id: string;
  code: string;
  createdAt: string;
  principal: { type: SupportPrincipalType; id: string };
  records: ResolvedSupportRecord[];
}

@Injectable()
export class SupportReferenceService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    manager: EntityManager,
    input: {
      principalType: SupportPrincipalType;
      principalId: string;
      records: readonly SupportRecordRef[];
    },
  ): Promise<string> {
    if (input.records.length === 0) {
      throw new Error('A Support Reference must identify at least one server record');
    }

    let reference: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 5 && reference === null; attempt += 1) {
      const code = generateSupportReferenceCode();
      const result: unknown = await manager.query(
        `INSERT INTO support.support_references (code, principal_type, principal_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING
         RETURNING id, code`,
        [code, input.principalType, input.principalId],
      );
      reference = returningRows<{ id: string; code: string }>(result)[0] ?? null;
    }
    if (reference === null) {
      throw new Error('Could not allocate a unique Support Reference');
    }

    const records = manager.getRepository(SupportReferenceRecordEntity);
    await records.save(
      input.records.map((record) =>
        records.create({
          recordId: record.id,
          recordType: record.type,
          supportReferenceId: reference.id,
        }),
      ),
    );
    return reference.code;
  }

  async findCodeForRecord(type: SupportRecordType, id: string): Promise<string | null> {
    const record = await this.dataSource.getRepository(SupportReferenceRecordEntity).findOneBy({
      recordId: id,
      recordType: type,
    });
    if (record === null) {
      return null;
    }
    const reference = await this.dataSource
      .getRepository(SupportReferenceEntity)
      .findOneBy({ id: record.supportReferenceId });
    return reference?.code ?? null;
  }

  async findCodesForRecords(
    type: SupportRecordType,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) {
      return new Map();
    }
    const records = await this.dataSource.getRepository(SupportReferenceRecordEntity).find({
      where: { recordId: In([...ids]), recordType: type },
    });
    if (records.length === 0) {
      return new Map();
    }
    const references = await this.dataSource.getRepository(SupportReferenceEntity).findBy({
      id: In(records.map((record) => record.supportReferenceId)),
    });
    const codesByReference = new Map(references.map((reference) => [reference.id, reference.code]));
    return new Map(
      records.flatMap((record) => {
        const code = codesByReference.get(record.supportReferenceId);
        return code === undefined ? [] : [[record.recordId, code] as const];
      }),
    );
  }

  async resolve(value: string): Promise<ResolvedSupportReference | null> {
    const code = normalizeSupportReferenceCode(value);
    if (code === null) {
      return null;
    }
    const reference = await this.dataSource
      .getRepository(SupportReferenceEntity)
      .findOneBy({ code });
    if (reference === null) {
      return null;
    }
    const records = await this.dataSource
      .getRepository(SupportReferenceRecordEntity)
      .find({ where: { supportReferenceId: reference.id }, order: { recordType: 'ASC' } });
    return {
      code: reference.code,
      createdAt: reference.createdAt.toISOString(),
      id: reference.id,
      principal: { id: reference.principalId, type: reference.principalType },
      records: await Promise.all(
        records.map((record) => this.resolveRecord(record, reference)),
      ),
    };
  }

  private async resolveRecord(
    record: SupportReferenceRecordEntity,
    reference: SupportReferenceEntity,
  ): Promise<ResolvedSupportRecord> {
    let data = await this.loadRecord(record.recordType, record.recordId);
    // A malformed/manual link must fail closed instead of letting one player's
    // reference expose an account-owned record belonging to somebody else.
    if (
      data !== null &&
      typeof data.accountId === 'string' &&
      (reference.principalType !== 'account' || data.accountId !== reference.principalId)
    ) {
      data = null;
    }
    return { data, id: record.recordId, type: record.recordType };
  }

  private async loadRecord(
    type: SupportRecordType,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const queries: Record<SupportRecordType, string> = {
      ai_artwork: `SELECT id, account_id AS "accountId", processing_job_id AS "processingJobId",
                          status, failure_reason AS "failureReason", created_at AS "createdAt",
                          updated_at AS "updatedAt"
                   FROM ai.ai_artworks WHERE id = $1`,
      ai_credit_pack_purchase_reconciliation:
        `SELECT id, account_id AS "accountId", product_key AS "productKey",
                provider_transaction_id AS "providerTransactionId", created_at AS "createdAt"
         FROM economy.ai_credit_pack_purchase_reconciliations WHERE id = $1`,
      coin_pack_purchase_reconciliation:
        `SELECT id, account_id AS "accountId", product_key AS "productKey",
                provider_transaction_id AS "providerTransactionId", created_at AS "createdAt"
         FROM economy.coin_pack_purchase_reconciliations WHERE id = $1`,
      premium_purchase_reconciliation:
        `SELECT id, account_id AS "accountId", operation, product_key AS "productKey",
                created_at AS "createdAt"
         FROM economy.premium_purchase_reconciliations WHERE id = $1`,
      pattern_conversion: `SELECT processing_job_id AS id, account_id AS "accountId",
                                  processing_job_id AS "processingJobId",
                                  target_pattern_id AS "targetPatternId", profile, title,
                                  created_at AS "createdAt"
                           FROM conversion.pattern_conversions WHERE processing_job_id = $1`,
      processing_job: `SELECT id, type, status, error_message AS "errorMessage",
                              created_at AS "createdAt", updated_at AS "updatedAt"
                       FROM jobs.processing_jobs WHERE id = $1`,
    };
    const rows = await this.dataSource.query<readonly Record<string, unknown>[]>(queries[type], [id]);
    return rows[0] ?? null;
  }
}
