export const UNLOCK_REQUIRED_NOTE = 'unlock_required';

export function isUnlockRequiredNote(note: string | null | undefined): boolean {
  return note === UNLOCK_REQUIRED_NOTE;
}

/** The catalog detail screen is where the Pattern Unlock happens. */
export function catalogDetailRoute(patternId: string) {
  return { pathname: '/(tabs)/(catalog)/[id]' as const, params: { id: patternId } };
}
