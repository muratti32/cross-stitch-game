import { ExecutionContext, ForbiddenException, GoneException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { PrincipalType } from '../auth/entities';
import { AccountStateService } from './account-state.service';
import { AccountWriteFreezeInterceptor } from './account-write-freeze.interceptor';

describe('AccountWriteFreezeInterceptor', () => {
  let interceptor: AccountWriteFreezeInterceptor;
  let accountStateService: AccountStateService;
  let getAccountStatusMock: jest.Mock;
  let mockGetRequest: jest.Mock;
  let mockContext: ExecutionContext;

  const mockCallHandler = {
    handle: () => of(null),
  };

  beforeEach(() => {
    getAccountStatusMock = jest.fn();
    accountStateService = {
      getAccountStatus: getAccountStatusMock,
    } as unknown as AccountStateService;

    interceptor = new AccountWriteFreezeInterceptor(accountStateService);

    mockGetRequest = jest.fn();
    mockContext = {
      switchToHttp: () => ({
        getRequest: mockGetRequest,
      }),
    } as unknown as ExecutionContext;
  });

  it('passes through when there is no principal', async () => {
    mockGetRequest.mockReturnValue({
      method: 'POST',
      path: '/v1/patterns/like',
    });

    const obs = await interceptor.intercept(mockContext, mockCallHandler);
    const val = await lastValueFrom(obs);
    expect(val).toBeNull();
    expect(getAccountStatusMock).not.toHaveBeenCalled();
  });

  it('GET on a closing account passes', async () => {
    mockGetRequest.mockReturnValue({
      method: 'GET',
      path: '/v1/patterns',
      principal: { type: PrincipalType.Account, id: 'acc-1' },
    });
    getAccountStatusMock.mockResolvedValue('closing');

    const obs = await interceptor.intercept(mockContext, mockCallHandler);
    const val = await lastValueFrom(obs);
    expect(val).toBeNull();
    expect(getAccountStatusMock).toHaveBeenCalledWith('acc-1');
  });

  it('POST on a closing account throws ForbiddenException carrying code ACCOUNT_CLOSING', async () => {
    mockGetRequest.mockReturnValue({
      method: 'POST',
      path: '/v1/patterns/like',
      principal: { type: PrincipalType.Account, id: 'acc-1' },
    });
    getAccountStatusMock.mockResolvedValue('closing');

    await expect(
      interceptor.intercept(mockContext, mockCallHandler),
    ).rejects.toThrow(
      new ForbiddenException({
        code: 'ACCOUNT_CLOSING',
        message: 'Account is pending deletion',
      }),
    );
    expect(getAccountStatusMock).toHaveBeenCalledWith('acc-1');
  });

  it('POST /v1/account/deletion/cancel on a closing account passes', async () => {
    mockGetRequest.mockReturnValue({
      method: 'POST',
      path: '/v1/account/deletion/cancel',
      principal: { type: PrincipalType.Account, id: 'acc-1' },
    });
    getAccountStatusMock.mockResolvedValue('closing');

    const obs = await interceptor.intercept(mockContext, mockCallHandler);
    const val = await lastValueFrom(obs);
    expect(val).toBeNull();
    expect(getAccountStatusMock).toHaveBeenCalledWith('acc-1');
  });

  it('POST from a guest principal passes without hitting the status lookup', async () => {
    mockGetRequest.mockReturnValue({
      method: 'POST',
      path: '/v1/patterns/like',
      principal: { type: PrincipalType.Guest, id: 'guest-1' },
    });

    const obs = await interceptor.intercept(mockContext, mockCallHandler);
    const val = await lastValueFrom(obs);
    expect(val).toBeNull();
    expect(getAccountStatusMock).not.toHaveBeenCalled();
  });

  it('POST on an active account passes', async () => {
    mockGetRequest.mockReturnValue({
      method: 'POST',
      path: '/v1/patterns/like',
      principal: { type: PrincipalType.Account, id: 'acc-2' },
    });
    getAccountStatusMock.mockResolvedValue('active');

    const obs = await interceptor.intercept(mockContext, mockCallHandler);
    const val = await lastValueFrom(obs);
    expect(val).toBeNull();
    expect(getAccountStatusMock).toHaveBeenCalledWith('acc-2');
  });

  it('POST on allowlisted paths passes through', async () => {
    mockGetRequest.mockReturnValue({
      method: 'POST',
      path: '/v1/auth/refresh',
      principal: { type: PrincipalType.Account, id: 'acc-1' },
    });
    getAccountStatusMock.mockResolvedValue('closing');

    const obs = await interceptor.intercept(mockContext, mockCallHandler);
    const val = await lastValueFrom(obs);
    expect(val).toBeNull();
    expect(getAccountStatusMock).toHaveBeenCalledWith('acc-1');
  });

  it('strips query strings before checking allowlist', async () => {
    mockGetRequest.mockReturnValue({
      method: 'POST',
      path: '/v1/account/deletion?foo=bar',
      principal: { type: PrincipalType.Account, id: 'acc-1' },
    });
    getAccountStatusMock.mockResolvedValue('closing');

    const obs = await interceptor.intercept(mockContext, mockCallHandler);
    const val = await lastValueFrom(obs);
    expect(val).toBeNull();
    expect(getAccountStatusMock).toHaveBeenCalledWith('acc-1');
  });

  it('GET on a deleted account throws GoneException carrying code ACCOUNT_DELETED', async () => {
    mockGetRequest.mockReturnValue({
      method: 'GET',
      path: '/v1/patterns',
      principal: { type: PrincipalType.Account, id: 'acc-1' },
    });
    getAccountStatusMock.mockResolvedValue('deleted');

    await expect(
      interceptor.intercept(mockContext, mockCallHandler),
    ).rejects.toThrow(
      new GoneException({
        code: 'ACCOUNT_DELETED',
        message: 'Account has been deleted',
      }),
    );
    expect(getAccountStatusMock).toHaveBeenCalledWith('acc-1');
  });

  it('POST on a deleted account throws GoneException carrying code ACCOUNT_DELETED', async () => {
    mockGetRequest.mockReturnValue({
      method: 'POST',
      path: '/v1/patterns/like',
      principal: { type: PrincipalType.Account, id: 'acc-1' },
    });
    getAccountStatusMock.mockResolvedValue('deleted');

    await expect(
      interceptor.intercept(mockContext, mockCallHandler),
    ).rejects.toThrow(
      new GoneException({
        code: 'ACCOUNT_DELETED',
        message: 'Account has been deleted',
      }),
    );
    expect(getAccountStatusMock).toHaveBeenCalledWith('acc-1');
  });
});
