import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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

  describe('link', () => {
    it('successfully links a new identity', async () => {
      const save = jest.fn();
      const create = jest.fn((attrs: Record<string, unknown>) => attrs);
      const findOne = jest.fn().mockResolvedValue(null);
      const query = jest.fn().mockResolvedValue([]);

      const manager = {
        query,
        getRepository: () => ({
          findOne,
          create,
          save,
        }),
      } as unknown as EntityManager;

      const dataSource = {
        transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
          work(manager),
      } as unknown as DataSource;

      const service = new AccountIdentityService(dataSource);

      await expect(
        service.link('account-id-123', {
          email: 'new@example.com',
          provider: 'google',
          subject: 'google-sub-456',
        }),
      ).resolves.not.toThrow();

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        ['google:google-sub-456'],
      );
      expect(findOne).toHaveBeenCalledWith({
        where: { provider: 'google', subject: 'google-sub-456' },
      });
      expect(create).toHaveBeenCalledWith({
        accountId: 'account-id-123',
        provider: 'google',
        subject: 'google-sub-456',
        email: 'new@example.com',
      });
      expect(save).toHaveBeenCalled();
    });

    it('rejects if identity is already bound to another account', async () => {
      const findOne = jest.fn().mockResolvedValue({
        accountId: 'different-account-id',
      });
      const query = jest.fn().mockResolvedValue([]);

      const manager = {
        query,
        getRepository: () => ({ findOne }),
      } as unknown as EntityManager;

      const dataSource = {
        transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
          work(manager),
      } as unknown as DataSource;

      const service = new AccountIdentityService(dataSource);

      await expect(
        service.link('account-id-123', {
          email: 'new@example.com',
          provider: 'google',
          subject: 'google-sub-456',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not reject if identity is already bound to the same account', async () => {
      const findOne = jest.fn().mockResolvedValue({
        accountId: 'account-id-123',
      });
      const query = jest.fn().mockResolvedValue([]);

      const manager = {
        query,
        getRepository: () => ({ findOne }),
      } as unknown as EntityManager;

      const dataSource = {
        transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
          work(manager),
      } as unknown as DataSource;

      const service = new AccountIdentityService(dataSource);

      await expect(
        service.link('account-id-123', {
          email: 'new@example.com',
          provider: 'google',
          subject: 'google-sub-456',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('unlink', () => {
    it('successfully unlinks a target identity', async () => {
      const remove = jest.fn();
      const find = jest.fn().mockResolvedValue([
        { provider: 'email', subject: 'email@example.com' },
        { provider: 'google', subject: 'google-sub-123' },
      ]);

      const manager = {
        getRepository: () => ({
          find,
          remove,
        }),
      } as unknown as EntityManager;

      const dataSource = {
        transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
          work(manager),
      } as unknown as DataSource;

      const service = new AccountIdentityService(dataSource);

      await expect(
        service.unlink('account-id-123', 'google', 'google-sub-123'),
      ).resolves.not.toThrow();

      expect(find).toHaveBeenCalledWith({ where: { accountId: 'account-id-123' } });
      expect(remove).toHaveBeenCalledWith({
        provider: 'google',
        subject: 'google-sub-123',
      });
    });

    it('rejects if target identity is the last remaining identity', async () => {
      const find = jest.fn().mockResolvedValue([
        { provider: 'email', subject: 'email@example.com' },
      ]);

      const manager = {
        getRepository: () => ({ find }),
      } as unknown as EntityManager;

      const dataSource = {
        transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
          work(manager),
      } as unknown as DataSource;

      const service = new AccountIdentityService(dataSource);

      await expect(
        service.unlink('account-id-123', 'email', 'email@example.com'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects if target identity is not found on the account', async () => {
      const find = jest.fn().mockResolvedValue([
        { provider: 'email', subject: 'email@example.com' },
        { provider: 'apple', subject: 'apple-sub-123' },
      ]);

      const manager = {
        getRepository: () => ({ find }),
      } as unknown as EntityManager;

      const dataSource = {
        transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
          work(manager),
      } as unknown as DataSource;

      const service = new AccountIdentityService(dataSource);

      await expect(
        service.unlink('account-id-123', 'google', 'google-sub-123'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
