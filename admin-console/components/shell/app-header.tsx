import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getOperatorProfile } from '@/lib/session';

import { LogoutButton } from './logout-button';

export async function AppHeader() {
  const operator = await getOperatorProfile();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <div className="text-sm text-muted-foreground">Stitch Wish Operator Console</div>
      <div className="flex items-center gap-3">
        {operator !== null && (
          <div className="flex items-center gap-2">
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">
                {operator.email.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">{operator.email}</span>
          </div>
        )}
        <LogoutButton />
      </div>
    </header>
  );
}
