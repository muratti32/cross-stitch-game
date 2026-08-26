export type FocusOwner = 'tutorial' | 'locator';

export function createFocusSlot() {
  let owner: FocusOwner | null = null;
  return {
    acquire(nextOwner: FocusOwner): void {
      owner = nextOwner;
    },
    release(releasingOwner: FocusOwner): boolean {
      if (owner !== releasingOwner) return false;
      owner = null;
      return true;
    },
    currentOwner(): FocusOwner | null {
      return owner;
    },
  };
}
