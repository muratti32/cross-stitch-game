import type { EntityManager } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';

/** Finds or creates the principal's one active session on a Pattern. */
export async function upsertActiveSession(
  manager: EntityManager,
  principal: Pick<AuthPrincipal, 'id' | 'type'>,
  patternId: string,
): Promise<string> {
  const rows = await manager.query<readonly { id: string }[]>(
    `INSERT INTO "sessions"."stitching_sessions" ("principal_type", "principal_id", "pattern_id", "status")
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT ("principal_type", "principal_id", "pattern_id") WHERE "status" = 'active'
     DO UPDATE SET "status" = 'active'
     RETURNING "id"`,
    [principal.type as string, principal.id, patternId],
  );
  const sessionId = rows[0].id;

  await manager.query(
    `INSERT INTO "sessions"."session_progress_flags" ("session_id", "has_any_progress")
     VALUES ($1, false)
     ON CONFLICT ("session_id") DO NOTHING`,
    [sessionId],
  );
  return sessionId;
}
