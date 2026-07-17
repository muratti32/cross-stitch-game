import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
}: {
  icon?: ComponentType<LucideProps>;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background px-6 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {message !== undefined && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
      {action}
    </div>
  );
}
