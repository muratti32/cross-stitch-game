import { OperatorRole } from './entities';

export interface OperatorAccessTokenPayload {
  jti: string;
  sub: string;
  principalType: 'operator';
  role: OperatorRole;
}

export interface OperatorPrincipal {
  id: string;
  role: OperatorRole;
}

export interface OperatorTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface OperatorAuthenticatedRequest {
  headers: {
    authorization?: string | readonly string[];
  };
  ip?: string;
  operatorPrincipal?: OperatorPrincipal;
}
