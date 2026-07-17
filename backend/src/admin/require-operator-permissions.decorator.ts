import { SetMetadata } from '@nestjs/common';

import { OperatorPermission } from './operator-permission';

export const OPERATOR_PERMISSIONS_KEY = 'operatorPermissions';

export const RequireOperatorPermissions = (
  ...permissions: OperatorPermission[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(OPERATOR_PERMISSIONS_KEY, permissions);
