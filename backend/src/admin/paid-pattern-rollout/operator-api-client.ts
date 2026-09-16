import { authenticator } from 'otplib';

import type { PatternPaidBulkResult } from '../pattern-paid-admin.service';
import type { PaidPatternCandidate } from './paid-pattern-selection';

export type OperatorFetch = typeof fetch;

/** Read requests are small; a hung socket must not stall the rollout silently. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** One bulk batch locks and grandfathers up to 50 Patterns sequentially. */
const BULK_REQUEST_TIMEOUT_MS = 300_000;

export class OperatorApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Operator API request failed with status ${status}`);
    this.name = 'OperatorApiError';
  }
}

export class OperatorApiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorApiResponseError';
  }
}

export interface OperatorLoginInput {
  email: string;
  password: string;
  totpCode?: string;
  totpSecret?: string;
}

export interface StaffPickResponseItem {
  patternId: string;
  title: string;
  creatorName: string;
  position: number;
  previewUrl: string;
}

export interface BulkSetPaidResponse {
  paid: boolean;
  results: PatternPaidBulkResult[];
}

export class OperatorApiClient {
  private readonly baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string, private readonly fetchImpl: OperatorFetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async login(input: OperatorLoginInput): Promise<void> {
    const loginBody = await this.requestUnknown('/auth/login', {
      method: 'POST',
      body: { email: input.email, password: input.password },
    });
    if (isAuthenticatedResponse(loginBody)) {
      this.accessToken = loginBody.accessToken;
      return;
    }
    if (!isMfaRequiredResponse(loginBody)) {
      throw new OperatorApiResponseError('Invalid operator login response');
    }
    const totpCode = input.totpCode ?? (
      input.totpSecret === undefined ? undefined : authenticator.generate(input.totpSecret)
    );
    if (totpCode === undefined) {
      throw new OperatorApiResponseError('Operator login requires a TOTP code or secret');
    }
    const mfaBody = await this.requestUnknown('/auth/mfa', {
      method: 'POST',
      body: { challenge: loginBody.challenge, totpCode },
    });
    if (!isAuthenticatedResponse(mfaBody)) {
      throw new OperatorApiResponseError('Invalid operator MFA response');
    }
    this.accessToken = mfaBody.accessToken;
  }

  async listPatterns(status: string): Promise<PaidPatternCandidate[]> {
    const items: PaidPatternCandidate[] = [];
    let page = 1;
    let total = 0;
    do {
      const body = await this.authenticatedRequestUnknown(
        `/patterns?status=${encodeURIComponent(status)}&page=${page}&pageSize=100`,
        { method: 'GET' },
      );
      if (!isPatternPage(body)) {
        throw new OperatorApiResponseError('Invalid pattern list response');
      }
      items.push(...body.items);
      total = body.total;
      page += 1;
      if (body.items.length === 0 && items.length < total) {
        throw new OperatorApiResponseError('Pattern list pagination ended before total items were fetched');
      }
    } while (items.length < total);
    return items;
  }

  async getStaffPicks(): Promise<StaffPickResponseItem[]> {
    const body = await this.authenticatedRequestUnknown('/staff-picks', { method: 'GET' });
    if (!Array.isArray(body) || !body.every(isStaffPickResponseItem)) {
      throw new OperatorApiResponseError('Invalid Staff Picks response');
    }
    return body;
  }

  async bulkSetPaid(
    patternIds: string[],
    paid: boolean,
    requestId: string,
  ): Promise<BulkSetPaidResponse> {
    const body = await this.authenticatedRequestUnknown('/patterns/bulk-paid', {
      method: 'POST',
      body: { paid, patternIds },
      requestId,
      timeoutMs: BULK_REQUEST_TIMEOUT_MS,
    });
    if (!isBulkSetPaidResponse(body)) {
      throw new OperatorApiResponseError('Invalid bulk paid response');
    }
    if (body.paid !== paid) {
      throw new OperatorApiResponseError('Bulk paid response did not match the requested state');
    }
    return body;
  }

  private authenticatedRequestUnknown(
    path: string,
    options: { method: string; body?: unknown; requestId?: string; timeoutMs?: number },
  ): Promise<unknown> {
    if (this.accessToken === null) {
      throw new OperatorApiResponseError('Operator API client is not authenticated');
    }
    return this.requestUnknown(path, options, this.accessToken);
  }

  private async requestUnknown(
    path: string,
    options: { method: string; body?: unknown; requestId?: string; timeoutMs?: number },
    accessToken?: string,
  ): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (accessToken !== undefined) headers.authorization = `Bearer ${accessToken}`;
    if (options.requestId !== undefined) headers['x-request-id'] = options.requestId;
    const response = await this.fetchImpl(`${this.baseUrl}/v1/admin${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method: options.method,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const body = parseResponseBody(text);
    if (!response.ok) {
      throw new OperatorApiError(response.status, body);
    }
    if (text.length === 0) {
      return null;
    }
    if (body === undefined) {
      throw new OperatorApiResponseError('Operator API returned invalid JSON');
    }
    return body;
  }
}

function parseResponseBody(text: string): unknown {
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAuthenticatedResponse(value: unknown): value is {
  status: 'authenticated';
  accessToken: string;
  refreshToken: string;
  operator: { id: string; email: string; role: string };
} {
  return isRecord(value)
    && value.status === 'authenticated'
    && typeof value.accessToken === 'string'
    && typeof value.refreshToken === 'string'
    && isOperator(value.operator);
}

function isMfaRequiredResponse(value: unknown): value is {
  status: 'mfa_required';
  challenge: string;
  expiresAt: string;
} {
  return isRecord(value)
    && value.status === 'mfa_required'
    && typeof value.challenge === 'string'
    && typeof value.expiresAt === 'string';
}

function isOperator(value: unknown): value is { id: string; email: string; role: string } {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.email === 'string'
    && typeof value.role === 'string';
}

function isPatternPage(value: unknown): value is {
  items: PaidPatternCandidate[];
  total: number;
} {
  return isRecord(value)
    && Array.isArray(value.items)
    && value.items.every(isPaidPatternCandidate)
    && typeof value.total === 'number'
    && Number.isSafeInteger(value.total)
    && value.total >= 0
    && typeof value.page === 'number'
    && Number.isSafeInteger(value.page)
    && value.page >= 1
    && typeof value.pageSize === 'number'
    && Number.isSafeInteger(value.pageSize)
    && value.pageSize >= 1;
}

function isPaidPatternCandidate(value: unknown): value is PaidPatternCandidate {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.categoryCode === 'string'
    && typeof value.status === 'string'
    && (value.patternType === 'official' || value.patternType === 'community')
    && isPatternTier(value.unlockPriceTier)
    && (
      value.stitchableCellCount === null
      || (
        typeof value.stitchableCellCount === 'number'
        && Number.isSafeInteger(value.stitchableCellCount)
      )
    );
}

function isPatternTier(value: unknown): value is PaidPatternCandidate['unlockPriceTier'] {
  return value === null || value === 'small' || value === 'medium' || value === 'large';
}

function isStaffPickResponseItem(value: unknown): value is StaffPickResponseItem {
  return isRecord(value)
    && typeof value.patternId === 'string'
    && typeof value.title === 'string'
    && typeof value.creatorName === 'string'
    && typeof value.position === 'number'
    && Number.isSafeInteger(value.position)
    && value.position >= 1
    && typeof value.previewUrl === 'string';
}

function isBulkSetPaidResponse(value: unknown): value is BulkSetPaidResponse {
  return isRecord(value)
    && typeof value.paid === 'boolean'
    && Array.isArray(value.results)
    && value.results.every(isPatternPaidBulkResult);
}

function isPatternPaidBulkResult(value: unknown): value is PatternPaidBulkResult {
  if (!isRecord(value) || typeof value.patternId !== 'string') return false;
  if (value.outcome === 'failed') {
    return value.errorCode === 'pattern_not_found'
      || value.errorCode === 'pattern_not_eligible'
      || value.errorCode === 'stitchable_cell_count_unknown'
      || value.errorCode === 'internal_error';
  }
  return (value.outcome === 'changed' || value.outcome === 'unchanged')
    && isPatternTier(value.beforeTier)
    && isPatternTier(value.afterTier)
    && typeof value.grandfatheredCount === 'number'
    && Number.isSafeInteger(value.grandfatheredCount)
    && value.grandfatheredCount >= 0;
}
