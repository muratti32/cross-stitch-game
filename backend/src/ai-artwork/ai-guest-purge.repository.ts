import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/**
 * Owns the `ai` schema rows one Guest Installation leaves behind, so a Guest
 * Data Reset never issues AI-owned SQL from another module. The caller supplies
 * the transaction so the whole reset commits as one unit.
 */
@Injectable()
export class AiGuestPurgeRepository {
  async purgeGuest(manager: EntityManager, guestInstallationId: string): Promise<void> {
    await manager.query(
      `DELETE FROM ai.ai_credit_reservations WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM ai.ai_artworks WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
    await manager.query(
      `DELETE FROM ai.prompt_safety_attempts WHERE guest_installation_id = $1`,
      [guestInstallationId],
    );
  }
}
