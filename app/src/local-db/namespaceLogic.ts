/**
 * Pure logic for database filename mapping and adoption decisions.
 * This file must not import any React Native or Expo modules to remain 100% testable in Jest.
 */

/**
 * Returns the SQLite filename for a given identity namespace.
 * If identity is null, returns the pre-identity database name 'stitch_wish.db'.
 */
export function getDatabaseFilename(identity: string | null): string {
  if (!identity) {
    return 'stitch_wish.db';
  }
  return `namespace_guest_${identity}.db`;
}

/**
 * Returns the absolute path of the SQLite database file in the document directory.
 */
export function getDatabasePath(documentDirectory: string, filename: string): string {
  // Ensure we don't double-slash
  const base = documentDirectory.endsWith('/') ? documentDirectory : `${documentDirectory}/`;
  return `${base}SQLite/${filename}`;
}

/**
 * Decision logic for whether we should adopt the pre-identity database.
 * We adopt if the pre-identity database exists and the target guest database does not yet exist.
 */
export function shouldAdopt(hasPreIdentityDb: boolean, hasGuestDb: boolean): boolean {
  return hasPreIdentityDb && !hasGuestDb;
}
