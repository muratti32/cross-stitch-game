import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { RefreshTokensRepository } from '../auth/refresh-tokens.repository';
import { AccountDeletionService } from './account-deletion.service';
import { AccountStateService } from './account-state.service';
import { AccountClosureWorkloadService } from './account-closure-workload.service';

describe('AccountDeletionService', () => {
  let queryMock: jest.Mock<Promise<unknown>, [string, (unknown[] | undefined)?]>;
  let transactionMock: jest.Mock;
  let revokeAllForPrincipal: jest.Mock;
  let invalidateMock: jest.Mock;
  let cancelUnsubmittedWorkMock: jest.Mock;
  let service: AccountDeletionService;

  beforeEach(() => {
    queryMock = jest.fn<Promise<unknown>, [string, (unknown[] | undefined)?]>();
    transactionMock = jest.fn().mockImplementation((cb: (manager: EntityManager) => Promise<unknown>) => {
      const fakeManager = {
        query: queryMock,
      } as unknown as EntityManager;
      return cb(fakeManager);
    });

    revokeAllForPrincipal = jest.fn().mockResolvedValue(undefined);
    invalidateMock = jest.fn();
    cancelUnsubmittedWorkMock = jest.fn().mockResolvedValue({ artworks: 0, promotions: 0 });

    const dataSource = {
      query: queryMock,
      transaction: transactionMock,
    } as unknown as DataSource;

    const repository = {
      revokeAllForPrincipal,
    } as unknown as RefreshTokensRepository;

    const accountStateService = {
      invalidate: invalidateMock,
    } as unknown as AccountStateService;

    const accountClosureWorkloadService = {
      cancelUnsubmittedWork: cancelUnsubmittedWorkMock,
    } as unknown as AccountClosureWorkloadService;

    service = new AccountDeletionService(
      dataSource,
      repository,
      accountStateService,
      accountClosureWorkloadService,
    );
  });

  const getAccountPrincipal = (authTime: number = Math.floor(Date.now() / 1000)): AuthPrincipal => ({
    id: 'account-uuid-1234',
    tokenVersion: 1,
    type: PrincipalType.Account,
    authTime,
  });

  const getGuestPrincipal = (): AuthPrincipal => ({
    id: 'guest-uuid-1234',
    tokenVersion: 1,
    type: PrincipalType.Guest,
    authTime: Math.floor(Date.now() / 1000),
  });

  it('rejects request and cancel if principal type is not Account', async () => {
    const guest = getGuestPrincipal();

    await expect(service.request(guest)).rejects.toThrow(ForbiddenException);
    await expect(service.cancel(guest)).rejects.toThrow(ForbiddenException);
    await expect(service.getStatus(guest)).rejects.toThrow(ForbiddenException);
  });

  it('rejects request and cancel if authTime is missing or older than 300s', async () => {
    const accountStale = getAccountPrincipal(Math.floor(Date.now() / 1000) - 301);
    const accountMissing = getAccountPrincipal();
    delete accountMissing.authTime;

    await expect(service.request(accountStale)).rejects.toThrow(UnauthorizedException);
    await expect(service.cancel(accountStale)).rejects.toThrow(UnauthorizedException);

    await expect(service.request(accountMissing)).rejects.toThrow(UnauthorizedException);
    await expect(service.cancel(accountMissing)).rejects.toThrow(UnauthorizedException);
  });

  it('performs a happy-path deletion request, updating status and revoking sessions', async () => {
    const account = getAccountPrincipal();
    const requestedAt = new Date();
    const recoveryWindowEndsAt = new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    queryMock
      .mockResolvedValueOnce([{ status: 'active' }]) // SELECT status
      .mockResolvedValueOnce([{ id: 'request-uuid', requestedAt, recoveryWindowEndsAt }]) // INSERT request
      .mockResolvedValueOnce([]) // UPDATE status
      .mockResolvedValueOnce([]) // UPDATE creator_profiles hold
      .mockResolvedValueOnce([]) // INSERT audit event
      .mockResolvedValueOnce([]); // INSERT audit event 2

    const result = await service.request(account);

    expect(result).toEqual({
      status: 'pending',
      requestedAt,
      recoveryWindowEndsAt,
    });
    expect(cancelUnsubmittedWorkMock).toHaveBeenCalledWith(account.id, expect.any(Object));
    expect(queryMock).toHaveBeenCalledTimes(6);
    const sqlCalls = queryMock.mock.calls.map((call) => call[0]);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE auth.registered_accounts'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE moderation.creator_profiles') && sql.includes('closure_hold_at = now()'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('closure_workload_cancelled'))).toBe(true);
    expect(revokeAllForPrincipal).toHaveBeenCalledWith(PrincipalType.Account, account.id);
    expect(invalidateMock).toHaveBeenCalledWith(account.id);
  });

  it('returns the existing pending deletion request idempotently if account status is already closing', async () => {
    const account = getAccountPrincipal();
    const requestedAt = new Date();
    const recoveryWindowEndsAt = new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    queryMock
      .mockResolvedValueOnce([{ status: 'closing' }]) // SELECT status
      .mockResolvedValueOnce([{ requestedAt, recoveryWindowEndsAt }]); // SELECT pending request

    const result = await service.request(account);

    expect(result).toEqual({
      status: 'pending',
      requestedAt,
      recoveryWindowEndsAt,
    });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(revokeAllForPrincipal).toHaveBeenCalledWith(PrincipalType.Account, account.id);
    expect(invalidateMock).toHaveBeenCalledWith(account.id);
  });

  it('rejects deletion request if account status is not active or closing', async () => {
    const account = getAccountPrincipal();

    queryMock.mockResolvedValueOnce([{ status: 'closed' }]); // SELECT status

    await expect(service.request(account)).rejects.toThrow(ConflictException);
  });

  it('cancels a pending deletion request and restores account status to active', async () => {
    const account = getAccountPrincipal();
    const recoveryWindowEndsAt = new Date(Date.now() + 100000);

    queryMock
      .mockResolvedValueOnce([{ status: 'closing' }]) // SELECT status
      .mockResolvedValueOnce([{ id: 'request-uuid', recoveryWindowEndsAt }]) // SELECT pending request
      .mockResolvedValueOnce([]) // UPDATE status cancelled
      .mockResolvedValueOnce([]) // UPDATE registered accounts active
      .mockResolvedValueOnce([]) // UPDATE creator_profiles hold released
      .mockResolvedValueOnce([]); // INSERT audit event

    const result = await service.cancel(account);

    expect(result).toEqual({ status: 'none' });
    expect(queryMock).toHaveBeenCalledTimes(6);
    const sqlCalls = queryMock.mock.calls.map((call) => call[0]);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE auth.registered_accounts') && sql.includes("SET status = 'active'"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE moderation.creator_profiles') && sql.includes('SET closure_hold_at = NULL'))).toBe(true);
    expect(invalidateMock).toHaveBeenCalledWith(account.id);
  });

  it('throws NotFoundException on cancel if there is no pending deletion request', async () => {
    const account = getAccountPrincipal();

    queryMock
      .mockResolvedValueOnce([{ status: 'closing' }]) // SELECT status
      .mockResolvedValueOnce([]); // SELECT pending request (none)

    await expect(service.cancel(account)).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException on cancel if recovery window has expired', async () => {
    const account = getAccountPrincipal();
    const recoveryWindowEndsAt = new Date(Date.now() - 10000); // expired

    queryMock
      .mockResolvedValueOnce([{ status: 'closing' }]) // SELECT status
      .mockResolvedValueOnce([{ id: 'request-uuid', recoveryWindowEndsAt }]); // SELECT pending request

    await expect(service.cancel(account)).rejects.toThrow(ConflictException);
  });

  it('returns none for getStatus if no pending deletion request is found', async () => {
    const account = getAccountPrincipal();

    queryMock.mockResolvedValueOnce([]); // SELECT pending request

    const result = await service.getStatus(account);

    expect(result).toEqual({ status: 'none' });
  });

  it('returns pending details for getStatus if pending deletion request is found', async () => {
    const account = getAccountPrincipal();
    const requestedAt = new Date();
    const recoveryWindowEndsAt = new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    queryMock.mockResolvedValueOnce([{ requestedAt, recoveryWindowEndsAt }]); // SELECT pending request

    const result = await service.getStatus(account);

    expect(result).toEqual({
      status: 'pending',
      requestedAt,
      recoveryWindowEndsAt,
    });
  });
});
