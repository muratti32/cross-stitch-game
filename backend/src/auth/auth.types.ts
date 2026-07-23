import { PrincipalType } from './entities';

export interface AccessTokenPayload {
  jti: string;
  principalType: PrincipalType;
  sub: string;
  tokenVersion: number;
  authTime?: number;
}

export interface AuthPrincipal {
  id: string;
  tokenVersion: number;
  type: PrincipalType;
  authTime?: number;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface GuestAuthResponse extends AuthTokenPair {
  guestId: string;
}

export interface AccountAuthResponse extends AuthTokenPair {
  accountId: string;
}

export interface FederatedAccountAuthResponse extends AccountAuthResponse {
  email: string | null;
  provider: 'apple' | 'google';
}

export interface AuthenticatedRequest {
  headers: {
    authorization?: string | readonly string[];
  };
  principal?: AuthPrincipal;
}
