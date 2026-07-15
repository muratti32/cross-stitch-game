import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

import { PrincipalType } from '../auth/entities';
import type { AuthPrincipal } from '../auth/auth.types';

interface SessionRecord {
  id: string;
  principalType: string;
  principalId: string;
}

interface SyncStateRecord {
  revision: string;
  terminalCompletedAt: Date | null;
}

interface PatternDimensionsRecord {
  width: number;
  height: number;
}

interface CellStateRecord {
  cellIndex: number;
  state: 'completed' | 'incomplete';
}

interface WatermarkRecord {
  deviceId: string;
  appliedThroughSeq: string;
}

interface CheckpointRecord {
  revision: string;
  checksumHex: string;
  formatVersion: number;
  deviceWatermarks: unknown;
  terminalCompleted: boolean;
  packedBitmap: Buffer;
}

interface RevisionRecord {
  revision: string;
}

interface DeletableDeviceRecord {
  deviceId: string;
  maxDeletableSeq: string;
}

export interface LatestCheckpoint {
  revision: number;
  checksumHex: string;
  formatVersion: number;
  deviceWatermarks: Record<string, number>;
  terminalCompleted: boolean;
  packedBitmapBase64: string;
}

@Injectable()
export class ProgressCheckpointService {
  constructor(private readonly dataSource: DataSource) {}

  async writeCheckpoint(
    manager: EntityManager,
    sessionId: string,
    terminal: boolean,
  ): Promise<void> {
    const [syncState, dimensions, cells, watermarks] = await Promise.all([
      this.getSyncState(manager, sessionId),
      this.getPatternDimensions(manager, sessionId),
      manager.query<readonly CellStateRecord[]>(
        `SELECT cell_index AS "cellIndex", state
         FROM sessions.session_cell_state
         WHERE session_id = $1`,
        [sessionId],
      ),
      manager.query<readonly WatermarkRecord[]>(
        `SELECT device_id AS "deviceId", applied_through_seq AS "appliedThroughSeq"
         FROM sessions.session_device_watermarks
         WHERE session_id = $1`,
        [sessionId],
      ),
    ]);

    const totalCells = dimensions.width * dimensions.height;
    const packedBitmap = Buffer.alloc(Math.ceil(totalCells / 8));
    for (const cell of cells) {
      if (cell.state === 'completed' && cell.cellIndex < totalCells) {
        packedBitmap[Math.floor(cell.cellIndex / 8)] |= 1 << (cell.cellIndex % 8);
      }
    }

    const deviceWatermarks = this.toWatermarkObject(watermarks);
    const checksum = createHash('sha256').update(packedBitmap).digest('hex');
    const terminalCompleted = terminal || syncState.terminalCompletedAt !== null;

    await manager.query<readonly CheckpointRecord[]>(
      `INSERT INTO sessions.session_checkpoints (
         session_id, revision, packed_bitmap, checksum, format_version,
         device_watermarks, terminal_completed
       ) VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6)
       ON CONFLICT (session_id, revision) DO UPDATE
       SET packed_bitmap = EXCLUDED.packed_bitmap,
           checksum = EXCLUDED.checksum,
           format_version = EXCLUDED.format_version,
           device_watermarks = EXCLUDED.device_watermarks,
           terminal_completed = EXCLUDED.terminal_completed`,
      [
        sessionId,
        syncState.revision,
        packedBitmap,
        checksum,
        JSON.stringify(deviceWatermarks),
        terminalCompleted,
      ],
    );
  }

  async getLatestCheckpoint(
    principal: AuthPrincipal,
    sessionId: string,
  ): Promise<LatestCheckpoint | null> {
    return this.dataSource.transaction(async (manager) => {
      await this.requireAccountSession(manager, principal, sessionId);
      const rows = await manager.query<readonly CheckpointRecord[]>(
        `SELECT revision,
                checksum AS "checksumHex",
                format_version AS "formatVersion",
                device_watermarks AS "deviceWatermarks",
                terminal_completed AS "terminalCompleted",
                packed_bitmap AS "packedBitmap"
         FROM sessions.session_checkpoints
         WHERE session_id = $1
         ORDER BY revision DESC
         LIMIT 1`,
        [sessionId],
      );
      const checkpoint = rows[0];
      if (!checkpoint) {
        return null;
      }

      return {
        revision: Number(checkpoint.revision),
        checksumHex: checkpoint.checksumHex.trim(),
        formatVersion: checkpoint.formatVersion,
        deviceWatermarks: this.parseWatermarkObject(checkpoint.deviceWatermarks),
        terminalCompleted: checkpoint.terminalCompleted,
        packedBitmapBase64: checkpoint.packedBitmap.toString('base64'),
      };
    });
  }

  async compactOnce(sessionId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockSession(manager, sessionId);
      await this.ensureSyncState(manager, sessionId);

      const latestRows = await manager.query<readonly RevisionRecord[]>(
        `SELECT revision
         FROM sessions.session_checkpoints
         WHERE session_id = $1
         ORDER BY revision DESC
         LIMIT 1`,
        [sessionId],
      );
      const syncState = await this.getSyncState(manager, sessionId);
      const latest = latestRows[0] ?? null;
      if (latest === null || Number(latest.revision) < Number(syncState.revision)) {
        await this.writeCheckpoint(
          manager,
          sessionId,
          syncState.terminalCompletedAt !== null,
        );
      }

      const checkpointRows = await manager.query<readonly RevisionRecord[]>(
        `SELECT revision
         FROM sessions.session_checkpoints
         WHERE session_id = $1
         ORDER BY revision DESC
         LIMIT 1`,
        [sessionId],
      );
      const checkpoint = checkpointRows[0];
      if (!checkpoint) {
        return;
      }

      const deletableDevices = await manager.query<readonly DeletableDeviceRecord[]>(
        `SELECT device_id AS "deviceId", MAX(device_seq) AS "maxDeletableSeq"
         FROM sessions.progress_operations
         WHERE session_id = $1 AND server_revision <= $2
         GROUP BY device_id`,
        [sessionId, checkpoint.revision],
      );

      for (const device of deletableDevices) {
        await manager.query<readonly DeletableDeviceRecord[]>(
          `DELETE FROM sessions.progress_operations
           WHERE session_id = $1
             AND device_id = $2
             AND device_seq <= $3`,
          [sessionId, device.deviceId, device.maxDeletableSeq],
        );
        await manager.query<readonly WatermarkRecord[]>(
          `INSERT INTO sessions.session_device_watermarks (
             session_id, device_id, applied_through_seq, updated_at
           ) VALUES ($1, $2, $3, now())
           ON CONFLICT (session_id, device_id) DO UPDATE
           SET applied_through_seq = GREATEST(
                 sessions.session_device_watermarks.applied_through_seq,
                 EXCLUDED.applied_through_seq
               ),
               updated_at = now()`,
          [sessionId, device.deviceId, device.maxDeletableSeq],
        );
      }
    });
  }

  private async requireAccountSession(
    manager: EntityManager,
    principal: AuthPrincipal,
    sessionId: string,
  ): Promise<SessionRecord> {
    if (principal.type !== PrincipalType.Account) {
      throw new NotFoundException('Session not found');
    }

    const sessions = await manager.query<readonly SessionRecord[]>(
      `SELECT id,
              principal_type AS "principalType",
              principal_id AS "principalId"
       FROM sessions.stitching_sessions
       WHERE id = $1
         AND principal_type = 'account'
         AND principal_id = $2
       FOR UPDATE`,
      [sessionId, principal.id],
    );
    const session = sessions[0] ?? null;
    if (!session || session.principalType !== 'account' || session.principalId !== principal.id) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  private async ensureSyncState(manager: EntityManager, sessionId: string): Promise<void> {
    await manager.query<readonly SyncStateRecord[]>(
      `INSERT INTO sessions.session_sync_state (session_id)
       VALUES ($1)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId],
    );
  }

  private async getSyncState(
    manager: EntityManager,
    sessionId: string,
  ): Promise<SyncStateRecord> {
    const states = await manager.query<readonly SyncStateRecord[]>(
      `SELECT revision, terminal_completed_at AS "terminalCompletedAt"
       FROM sessions.session_sync_state
       WHERE session_id = $1`,
      [sessionId],
    );
    const state = states[0];
    if (!state) {
      throw new NotFoundException('Session sync state not found');
    }
    return state;
  }

  private async getPatternDimensions(
    manager: EntityManager,
    sessionId: string,
  ): Promise<PatternDimensionsRecord> {
    const dimensions = await manager.query<readonly PatternDimensionsRecord[]>(
      `SELECT p.width, p.height
       FROM sessions.stitching_sessions s
       INNER JOIN catalog.patterns p ON p.id = s.pattern_id
       WHERE s.id = $1`,
      [sessionId],
    );
    const dimension = dimensions[0];
    if (!dimension) {
      throw new NotFoundException('Session not found');
    }
    return dimension;
  }

  private async lockSession(manager: EntityManager, sessionId: string): Promise<void> {
    await manager.query<readonly { locked: null }[]>(
      `SELECT pg_advisory_xact_lock(
         hashtextextended($1::text, 0)
       ) AS locked`,
      [sessionId],
    );
  }

  private toWatermarkObject(
    watermarks: readonly WatermarkRecord[],
  ): Record<string, number> {
    const result: Record<string, number> = {};
    for (const watermark of watermarks) {
      result[watermark.deviceId] = Number(watermark.appliedThroughSeq);
    }
    return result;
  }

  private parseWatermarkObject(value: unknown): Record<string, number> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {};
    }

    const result: Record<string, number> = {};
    for (const [deviceId, sequence] of Object.entries(value)) {
      if (typeof sequence === 'number') {
        result[deviceId] = sequence;
      }
    }
    return result;
  }
}
