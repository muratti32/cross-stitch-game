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

export function previewContentType(objectKey: string): string {
  if (objectKey.endsWith('.png')) return 'image/png';
  if (objectKey.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

// Deterministic from the Pattern id and its (never-nulled) previewObjectKey,
// so Safety Removal and a later Safety Removal Appeal acceptance agree on
// the private archive location without persisting an extra column.
export function safetyRemovalPreviewArchiveKey(
  patternId: string,
  previewObjectKey: string,
): string {
  const dotIndex = previewObjectKey.lastIndexOf('.');
  const extension = dotIndex === -1 ? '' : previewObjectKey.slice(dotIndex);
  return `moderation-archive/${patternId}/preview${extension}`;
}
