import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Owns the `conversion` schema rows one Guest Installation leaves behind, so a
 * Guest Data Reset never issues conversion-owned SQL from another module. The
 * caller supplies the transaction so the whole reset commits as one unit.
 */
@Injectable()
export class ConversionGuestPurgeRepository {
  async purgeGuest(manager: EntityManager, guestInstallationId: string): Promise<void> {
    await manager.query(
      `DELETE FROM conversion.pattern_conversions WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM conversion.personal_patterns WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
  }
}
