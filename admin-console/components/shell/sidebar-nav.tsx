'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Images,
  UploadCloud,
  Star,
  Tags,
  Shapes,
  SearchCheck,
  ClipboardCheck,
  FileEdit,
  Scale,
  ShieldAlert,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/patterns', icon: Images, label: 'Patterns' },
  { href: '/drafts', icon: UploadCloud, label: 'Drafts' },
  { href: '/submissions', icon: ClipboardCheck, label: 'Catalog Review' },
  { href: '/metadata-revisions', icon: FileEdit, label: 'Metadata Revisions' },
  { href: '/post-publication-reviews', icon: ShieldAlert, label: 'Reported Patterns' },
  { href: '/staff-picks', icon: Star, label: 'Staff Picks' },
  { href: '/tags', icon: Tags, label: 'Tags' },
  { href: '/categories', icon: Shapes, label: 'Categories' },
  { href: '/support-references', icon: SearchCheck, label: 'Support References' },
  { href: '/reconciliation', icon: Scale, label: 'Reconciliation' },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
