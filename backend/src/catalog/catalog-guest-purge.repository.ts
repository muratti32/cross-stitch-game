import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Owns the `catalog` schema rows one Guest Installation leaves behind, so a
 * Guest Data Reset never issues catalog-owned SQL from another module. The
 * caller supplies the transaction so the whole reset commits as one unit.
 */
@Injectable()
export class CatalogGuestPurgeRepository {
  async purgeGuest(manager: EntityManager, guestInstallationId: string): Promise<void> {
    await manager.query(
      `DELETE FROM catalog.patterns WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
  }
}
