import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class InvalidatedNamespaceTokenService {
  constructor(private readonly dataSource: DataSource) {}

  async isInvalidated(tokenHash: string): Promise<boolean> {
    const rows = await this.dataSource.query<readonly { exists: boolean }[]>(
      `SELECT EXISTS(
        SELECT 1
        FROM "deletion"."invalidated_namespace_tokens"
        WHERE "token_hash" = $1
      ) AS "exists"`,
      [tokenHash],
    );
    return rows[0]?.exists ?? false;
  }
}
