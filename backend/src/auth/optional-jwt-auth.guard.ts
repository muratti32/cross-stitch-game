import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedRequest } from './auth.types';

@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;
    if (!authorization) {
      request.principal = undefined;
      return true;
    }

    try {
      await super.canActivate(context);
    } catch {
      request.principal = undefined;
    }

    return true;
  }
}
