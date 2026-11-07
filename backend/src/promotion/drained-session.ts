import type { EntityManager } from 'typeorm';

import { markSessionHasProgress } from '../sessions/active-session';

import { packCompletedCells, PackagedSession, unpackCompletedCells } from './packaged-session';

interface SurvivingSessionProgress {
  revision: number;
  packedBitmapBase64: string;
  terminalCompleted: boolean;
}

interface ApplyPackagedProgressInput {
  sessionId: string;
  deviceId: string;
  packaged: Pick<PackagedSession, 'status' | 'completedAt' | 'packedBitmapBase64'>;
  gridCells: number;
  stitchableCells: number;
}

/**
 * Folds a packed bitmap into a session. Only cells not yet completed are
 * written, so each gets one revision and one operation. Runs under the
 * session's sync lock to keep revisions contiguous with account sync.
 */
export async function applyPackagedProgress(
  manager: EntityManager,
  { sessionId, deviceId, packaged, gridCells, stitchableCells }: ApplyPackagedProgressInput,
): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, [sessionId]);
  await manager.query(
    `INSERT INTO sessions.session_sync_state (session_id)
     VALUES ($1)
     ON CONFLICT (session_id) DO NOTHING`,
    [sessionId],
  );

  const cells = unpackCompletedCells(Buffer.from(packaged.packedBitmapBase64, 'base64'), gridCells);
  if (cells.length > 0) {
    await writeCompletedCells(manager, sessionId, deviceId, cells);
  }
  if (packaged.status === 'completed') {
    await completeWhenFullyStitched(manager, sessionId, packaged.completedAt, gridCells, stitchableCells);
  }
}

async function writeCompletedCells(
  manager: EntityManager,
  sessionId: string,
  deviceId: string,
  cells: readonly number[],
): Promise<void> {
  // device_seq continues the writer's own sequence on this session, so
  // the (session, device, seq) constraint cannot reject a row and leave a
  // revision gap. Moved Guest operations can sit above the sync revision.
  await manager.query(
    `WITH base AS (
       SELECT GREATEST(
                sync.revision,
                COALESCE((SELECT MAX(server_revision) FROM sessions.progress_operations WHERE session_id = $1::uuid), 0)
              ) AS revision,
              COALESCE(
                (SELECT MAX(device_seq) FROM sessions.progress_operations WHERE session_id = $1::uuid AND device_id = $2::uuid),
                -1
              ) AS device_seq
       FROM sessions.session_sync_state sync
       WHERE sync.session_id = $1::uuid
     ),
     missing AS (
       SELECT packaged.cell_index,
              ROW_NUMBER() OVER (ORDER BY packaged.cell_index) AS position
       FROM unnest($3::int[]) AS packaged(cell_index)
       LEFT JOIN sessions.session_cell_state cell
         ON cell.session_id = $1::uuid
        AND cell.cell_index = packaged.cell_index
        AND cell.state = 'completed'
       WHERE cell.cell_index IS NULL
     ),
     written_cells AS (
       INSERT INTO sessions.session_cell_state (session_id, cell_index, state, revision)
       SELECT $1::uuid, missing.cell_index, 'completed', base.revision + missing.position
       FROM missing CROSS JOIN base
       ON CONFLICT (session_id, cell_index) DO UPDATE
       SET state = EXCLUDED.state, revision = EXCLUDED.revision
     ),
     written_operations AS (
       INSERT INTO sessions.progress_operations (
         session_id, op_id, device_id, device_seq, cell_index, desired_state,
         base_revision, server_revision, effective, superseded, resolved_state
       )
       SELECT $1::uuid, gen_random_uuid(), $2::uuid, base.device_seq + missing.position,
              missing.cell_index, 'completed', 0, base.revision + missing.position,
              true, false, 'completed'
       FROM missing CROSS JOIN base
     )
     UPDATE sessions.session_sync_state sync
     SET revision = base.revision + (SELECT COUNT(*) FROM missing), updated_at = now()
     FROM base
     WHERE sync.session_id = $1::uuid`,
    [sessionId, deviceId, cells],
  );
  await markSessionHasProgress(manager, sessionId);
}

/** Never mints a First Completion Reward: the commit already resolved the economy. */
async function completeWhenFullyStitched(
  manager: EntityManager,
  sessionId: string,
  completedAt: string | null,
  gridCells: number,
  stitchableCells: number,
): Promise<void> {
  const rows = await manager.query<readonly { completed: string }[]>(
    `SELECT COUNT(*) AS completed
     FROM sessions.session_cell_state
     WHERE session_id = $1 AND state = 'completed' AND cell_index < $2`,
    [sessionId, gridCells],
  );
  if (Number(rows[0].completed) !== stitchableCells) return;

  await manager.query(
    `UPDATE sessions.stitching_sessions
     SET status = 'completed', completed_at = COALESCE(completed_at, $2::timestamptz, now())
     WHERE id = $1 AND status <> 'completed'`,
    [sessionId, completedAt],
  );
  await manager.query(
    `UPDATE sessions.session_sync_state
     SET terminal_completed_at = COALESCE(terminal_completed_at, now()), updated_at = now()
     WHERE session_id = $1`,
    [sessionId],
  );
}

export async function readSurvivingSession(
  manager: EntityManager,
  sessionId: string,
): Promise<SurvivingSessionProgress> {
  const rows = await manager.query<
    readonly {
      revision: string | null;
      terminal: boolean;
      total_cells: number;
      completed_cells: readonly number[];
    }[]
  >(
    `SELECT sync.revision,
            session.status = 'completed' OR sync.terminal_completed_at IS NOT NULL AS terminal,
            pattern.width * pattern.height AS total_cells,
            ARRAY(
              SELECT cell.cell_index
              FROM sessions.session_cell_state cell
              WHERE cell.session_id = session.id AND cell.state = 'completed'
            ) AS completed_cells
     FROM sessions.stitching_sessions session
     INNER JOIN catalog.patterns pattern ON pattern.id = session.pattern_id
     LEFT JOIN sessions.session_sync_state sync ON sync.session_id = session.id
     WHERE session.id = $1`,
    [sessionId],
  );
  const [row] = rows;
  return {
    revision: Number(row.revision ?? 0),
    packedBitmapBase64: packCompletedCells(row.completed_cells, row.total_cells).toString('base64'),
    terminalCompleted: row.terminal,
  };
}
