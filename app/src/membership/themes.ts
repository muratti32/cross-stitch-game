import { useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { useMembership } from '@/api/membership';

export type ThreadFinish = 'matte' | 'satin';
export type MembershipThemeId = 'default' | 'rose-garden' | 'moonlit-aida';

export interface MembershipTheme {
  id: MembershipThemeId;
  name: string;
  premium: boolean;
  gridBackground: string;
  minorGridColor: string;
  majorGridColor: string;
  /** Surface treatment only; Completed Stitch geometry is never theme-specific. */
  threadFinish: ThreadFinish;
  celebrationAccent: string;
  celebrationSurface: string;
}

export const MEMBERSHIP_THEMES: readonly MembershipTheme[] = [
  {
    id: 'default',
    name: 'Classic Linen',
    premium: false,
    gridBackground: '#FAF6F0',
    minorGridColor: '#E6E1D8',
    majorGridColor: '#B6AE9F',
    threadFinish: 'matte',
    celebrationAccent: '#7A9A82',
    celebrationSurface: '#FFFFFF',
  },
  {
    id: 'rose-garden',
    name: 'Rose Garden',
    premium: true,
    gridBackground: '#FFF3F5',
    minorGridColor: '#F1D7DC',
    majorGridColor: '#C98390',
    threadFinish: 'satin',
    celebrationAccent: '#C36A76',
    celebrationSurface: '#FFF8F9',
  },
  {
    id: 'moonlit-aida',
    name: 'Moonlit Aida',
    premium: true,
    gridBackground: '#18262C',
    minorGridColor: '#32474F',
    majorGridColor: '#78909A',
    threadFinish: 'satin',
    celebrationAccent: '#66C4D1',
    celebrationSurface: '#EFFBFC',
  },
] as const;

export const DEFAULT_MEMBERSHIP_THEME = MEMBERSHIP_THEMES[0];
const THEME_KEY = 'stitch_wish.membership_theme';

interface ThemePreferenceState {
  hydrated: boolean;
  selectedThemeId: MembershipThemeId;
  hydrate: () => Promise<void>;
  selectTheme: (themeId: MembershipThemeId) => Promise<void>;
}

export const useMembershipThemePreference = create<ThemePreferenceState>((set, get) => ({
  hydrated: false,
  selectedThemeId: 'default',
  hydrate: async () => {
    if (get().hydrated) return;
    const saved = await SecureStore.getItemAsync(THEME_KEY).catch(() => null);
    const selectedThemeId = isMembershipThemeId(saved) ? saved : 'default';
    set({ hydrated: true, selectedThemeId });
  },
  selectTheme: async (themeId) => {
    set({ selectedThemeId: themeId });
    await SecureStore.setItemAsync(THEME_KEY, themeId).catch(() => undefined);
  },
}));

export function useActiveMembershipTheme(membershipEnabled = true): {
  theme: MembershipTheme;
  themeAccess: boolean;
  selectedThemeId: MembershipThemeId;
  selectTheme: (themeId: MembershipThemeId) => Promise<void>;
} {
  const membership = useMembership(membershipEnabled);
  const { selectedThemeId, selectTheme, hydrate } = useMembershipThemePreference();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void hydrate();
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [hydrate]);

  const themeAccess = Boolean(
    membership.data?.themeAccess &&
      membership.data.expiresAt &&
      new Date(membership.data.expiresAt).getTime() > now,
  );
  const theme = useMemo(() => {
    const selected = MEMBERSHIP_THEMES.find((candidate) => candidate.id === selectedThemeId);
    if (!selected || (selected.premium && !themeAccess)) return DEFAULT_MEMBERSHIP_THEME;
    return selected;
  }, [selectedThemeId, themeAccess]);

  return { theme, themeAccess, selectedThemeId, selectTheme };
}

export function resolveMembershipTheme(
  selectedThemeId: MembershipThemeId,
  themeAccess: boolean,
): MembershipTheme {
  const selected = MEMBERSHIP_THEMES.find((candidate) => candidate.id === selectedThemeId);
  if (!selected || (selected.premium && !themeAccess)) return DEFAULT_MEMBERSHIP_THEME;
  return selected;
}

function isMembershipThemeId(value: string | null): value is MembershipThemeId {
  return MEMBERSHIP_THEMES.some((theme) => theme.id === value);
}
