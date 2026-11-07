export const UNLOCK_REQUIRED_NOTE = 'unlock_required';

export function isUnlockRequiredNote(note: string | null | undefined): boolean {
  return note === UNLOCK_REQUIRED_NOTE;
}
