'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { authApi } from '@/lib/client/fetcher';

export function LogoutButton() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await authApi.post<void>('/api/auth/logout');
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isLoggingOut}
      onClick={() => void handleLogout()}
    >
      <LogOut className="size-4" />
      {isLoggingOut ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
