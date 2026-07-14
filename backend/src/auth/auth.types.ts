import { PrincipalType } from './entities';

export interface AccessTokenPayload {
  jti: string;
  principalType: PrincipalType;
  sub: string;
  tokenVersion: number;
}

export interface AuthPrincipal {
  id: string;
  tokenVersion: number;
  type: PrincipalType;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface GuestAuthResponse extends AuthTokenPair {
  guestId: string;
}

export interface AuthenticatedRequest {
  headers: {
    authorization?: string | readonly string[];
  };
  principal?: AuthPrincipal;
}
