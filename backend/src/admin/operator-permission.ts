import { OperatorRole } from './entities';

export type OperatorPermission =
  | 'catalog.pattern.read'
  | 'catalog.pattern.publish'
  | 'catalog.pattern.manage'
  | 'catalog.staffpick.manage'
  | 'catalog.tag.manage';

export const ALL_OPERATOR_PERMISSIONS: readonly OperatorPermission[] = [
  'catalog.pattern.read',
  'catalog.pattern.publish',
  'catalog.pattern.manage',
  'catalog.staffpick.manage',
  'catalog.tag.manage',
];

// Explicit role -> permission mapping from day one, even while `owner` is the
// only role: adding a second, narrower role later is additive here, not a
// rewrite of every guarded route.
export const OPERATOR_ROLE_PERMISSIONS: Readonly<
  Record<OperatorRole, ReadonlySet<OperatorPermission>>
> = {
  [OperatorRole.Owner]: new Set(ALL_OPERATOR_PERMISSIONS),
};

export function permissionsForRole(
  role: OperatorRole,
): ReadonlySet<OperatorPermission> {
  return OPERATOR_ROLE_PERMISSIONS[role];
}
