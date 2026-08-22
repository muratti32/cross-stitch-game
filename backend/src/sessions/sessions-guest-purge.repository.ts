import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Owns the `sessions` schema rows one Guest Installation leaves behind, so a
 * Guest Data Reset never issues sessions-owned SQL from another module. The
 * caller supplies the transaction so the whole reset commits as one unit.
 */
@Injectable()
export class SessionsGuestPurgeRepository {
  async purgeGuest(manager: EntityManager, guestInstallationId: string): Promise<void> {
    await manager.query(
      `DELETE FROM sessions.stitching_sessions
       WHERE principal_type = 'guest' AND principal_id = $1`,
      [guestInstallationId],
    );
  }
}
