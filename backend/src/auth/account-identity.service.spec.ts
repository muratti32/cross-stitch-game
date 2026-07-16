import { DataSource, type EntityManager } from 'typeorm';

import { AccountIdentityService } from './account-identity.service';

describe('AccountIdentityService', () => {
  it('keys federated identities by provider subject rather than email', async () => {
    const query = jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { account_id: '3cdd8082-64f4-45ca-9653-fd2282c9372d' },
      ]);
    const manager = { query } as unknown as EntityManager;
    const dataSource = {
      transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
        work(manager),
    } as unknown as DataSource;
    const service = new AccountIdentityService(dataSource);

    await expect(
      service.createOrOpen({
        email: 'Person@Example.test',
        provider: 'google',
        subject: 'google-provider-subject',
      }),
    ).resolves.toBe('3cdd8082-64f4-45ca-9653-fd2282c9372d');

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('pg_advisory_xact_lock'),
      ['google:google-provider-subject'],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        'WHERE "provider" = $1 AND "subject" = $2',
      ),
      ['google', 'google-provider-subject', 'person@example.test'],
    );
  });
});
