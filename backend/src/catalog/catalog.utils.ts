export interface CatalogCursor {
  publishedAt: string;
  id: string;
}

export function encodeCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

export function decodeCursor(cursorStr: string): CatalogCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursorStr, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.publishedAt === 'string' &&
    typeof candidate.id === 'string'
  ) {
    return { publishedAt: candidate.publishedAt, id: candidate.id };
  }
  return null;
}
