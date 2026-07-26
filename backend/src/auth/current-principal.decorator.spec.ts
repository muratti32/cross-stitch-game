import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { getCurrentPrincipal, getOptionalPrincipal } from './current-principal.decorator';
import { AuthenticatedRequest, AuthPrincipal } from './auth.types';
import { PrincipalType } from './entities';

function contextForPrincipal(principal: AuthPrincipal | undefined): ExecutionContext {
  const request = {
    principal,
  } as AuthenticatedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CurrentPrincipal & OptionalPrincipal Decorator Factory Functions', () => {
  const mockPrincipal: AuthPrincipal = {
    id: 'user-id',
    tokenVersion: 1,
    type: PrincipalType.Account,
  };

  describe('getCurrentPrincipal', () => {
    it('should return the principal when present', () => {
      const context = contextForPrincipal(mockPrincipal);
      const result = getCurrentPrincipal(undefined, context);
      expect(result).toEqual(mockPrincipal);
    });

    it('should throw UnauthorizedException when principal is undefined', () => {
      const context = contextForPrincipal(undefined);
      expect(() => getCurrentPrincipal(undefined, context)).toThrow(UnauthorizedException);
    });
  });

  describe('getOptionalPrincipal', () => {
    it('should return the principal when present', () => {
      const context = contextForPrincipal(mockPrincipal);
      const result = getOptionalPrincipal(undefined, context);
      expect(result).toEqual(mockPrincipal);
    });

    it('should return undefined when principal is undefined', () => {
      const context = contextForPrincipal(undefined);
      const result = getOptionalPrincipal(undefined, context);
      expect(result).toBeUndefined();
    });
  });
});
