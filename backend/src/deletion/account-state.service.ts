import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AccountStateService {
  private readonly cache = new Map<
    string,
    {
      status: 'active' | 'closed' | 'closing' | 'deleted' | null;
      expiresAt: number;
    }
  >();

  constructor(private readonly dataSource: DataSource) {}

  async getAccountStatus(
    accountId: string,
  ): Promise<'active' | 'closed' | 'closing' | 'deleted' | null> {
    const now = Date.now();
    const cached = this.cache.get(accountId);
    if (cached !== undefined && cached.expiresAt > now) {
      return cached.status;
    }

    const rows: readonly { status: 'active' | 'closed' | 'closing' | 'deleted' }[] =
      await this.dataSource.query(
        `SELECT status
         FROM auth.registered_accounts
         WHERE id = $1`,
        [accountId],
      );

    const status = rows[0]?.status ?? null;

    if (this.cache.size >= 10000) {
      for (const [key, value] of this.cache.entries()) {
        if (value.expiresAt <= now) {
          this.cache.delete(key);
        }
      }
    }

    this.cache.set(accountId, {
      status,
      expiresAt: now + 5000,
    });

    return status;
  }

  invalidate(accountId: string): void {
    this.cache.delete(accountId);
  }
}
