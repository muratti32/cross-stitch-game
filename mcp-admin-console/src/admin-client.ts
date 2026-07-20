import { authenticator } from 'otplib';

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Admin API error ${status}: ${JSON.stringify(body)}`);
    this.name = 'AdminApiError';
  }
}

interface Session {
  accessToken: string;
  refreshToken: string;
}

export interface MfaRequired {
  status: 'mfa_required';
  challenge: string;
  expiresAt: string;
}

export interface Authenticated {
  status: 'authenticated';
  operator: { id: string; email: string; role: string };
}

/**
 * Thin client over the Game Backend's `/v1/admin/*` operator API
 * (see backend/src/admin and ADR-0039). Holds the operator session
 * in memory only — nothing is persisted to disk by this process.
 */
export class AdminClient {
  private baseUrl: string;
  private session: Session | null = null;
  private pendingChallenge: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  /**
   * Logs in with email/password. The backend always requires MFA (ADR-0039)
   * and never skips it — if `totpSecret` is supplied, this generates the
   * current code itself (matching the backend's otplib `authenticator`
   * preset in operator-totp.service.ts: SHA1, 6 digits, 30s step) and
   * completes verifyMfa immediately, so the caller only deals with a single
   * authenticated result. Without `totpSecret`, this stops at the
   * mfa_required challenge for a manual admin_verify_mfa call.
   */
  async login(
    email: string,
    password: string,
    totpSecret?: string,
  ): Promise<MfaRequired | Authenticated> {
    const response = await this.rawRequest('POST', '/auth/login', { email, password });
    if (response.status === 'authenticated') {
      this.session = { accessToken: response.accessToken, refreshToken: response.refreshToken };
      this.pendingChallenge = null;
      return { status: 'authenticated', operator: response.operator };
    }
    if (response.status !== 'mfa_required') {
      // A differently-shaped 200 here means the account or server config is
      // not what this client expects.
      throw new Error('Expected mfa_required response from admin login');
    }
    this.pendingChallenge = response.challenge;
    if (totpSecret === undefined) {
      return response;
    }
    return this.verifyMfa({ totpCode: authenticator.generate(totpSecret) });
  }

  async verifyMfa(args: { totpCode?: string; recoveryCode?: string }): Promise<Authenticated> {
    if (this.pendingChallenge === null) {
      throw new Error('No pending login challenge. Call admin_login first.');
    }
    const response = await this.rawRequest('POST', '/auth/mfa', {
      challenge: this.pendingChallenge,
      totpCode: args.totpCode,
      recoveryCode: args.recoveryCode,
    });
    this.pendingChallenge = null;
    this.session = { accessToken: response.accessToken, refreshToken: response.refreshToken };
    return { status: 'authenticated', operator: response.operator };
  }

  async logout(): Promise<void> {
    if (this.session === null) {
      return;
    }
    const refreshToken = this.session.refreshToken;
    this.session = null;
    await this.rawRequest('POST', '/auth/logout', { refreshToken }).catch(() => undefined);
  }

  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (this.session === null) {
      throw new Error('Not authenticated. Call admin_login then admin_verify_mfa first.');
    }
    let response = await this.rawRequest(method, path, body, this.session.accessToken);
    return response;
  }

  async requestForm(method: string, path: string, form: FormData): Promise<unknown> {
    if (this.session === null) {
      throw new Error('Not authenticated. Call admin_login then admin_verify_mfa first.');
    }
    return this.rawFormRequest(method, path, form, this.session.accessToken);
  }

  private async refresh(): Promise<boolean> {
    if (this.session === null) {
      return false;
    }
    try {
      const response = (await this.rawRequest('POST', '/auth/refresh', {
        refreshToken: this.session.refreshToken,
      })) as { accessToken: string; refreshToken: string };
      this.session = { accessToken: response.accessToken, refreshToken: response.refreshToken };
      return true;
    } catch {
      this.session = null;
      return false;
    }
  }

  private async rawRequest(
    method: string,
    path: string,
    body?: unknown,
    accessToken?: string,
    isRetry = false,
  ): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (accessToken !== undefined) {
      headers.authorization = `Bearer ${accessToken}`;
    }
    const response = await fetch(`${this.baseUrl}/v1/admin${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && accessToken !== undefined && !isRetry) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return this.rawRequest(method, path, body, this.session?.accessToken, true);
      }
    }

    return this.parseResponse(response);
  }

  private async rawFormRequest(
    method: string,
    path: string,
    form: FormData,
    accessToken: string,
    isRetry = false,
  ): Promise<any> {
    const response = await fetch(`${this.baseUrl}/v1/admin${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}` },
      body: form,
    });

    if (response.status === 401 && !isRetry) {
      const refreshed = await this.refresh();
      if (refreshed && this.session !== null) {
        return this.rawFormRequest(method, path, form, this.session.accessToken, true);
      }
    }

    return this.parseResponse(response);
  }

  private async parseResponse(response: Response): Promise<any> {
    const text = await response.text();
    const data = text.length > 0 ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new AdminApiError(response.status, data);
    }
    return data;
  }
}
