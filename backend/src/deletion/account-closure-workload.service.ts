import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { AiArtworkEntity, AiCreditReservationEntity } from '../ai-artwork/entities';
import { PromotionTransferPackageEntity, PromotionLockEntity } from '../promotion/entities';

@Injectable()
export class AccountClosureWorkloadService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Cancel unsubmitted work (Processing Jobs, AI Artwork Reservations, Uncommitted Promotion Packages)
   * for an account that requested deletion. Called inside the request transaction.
   *
   * Note: restoreCancelledWork is NOT required. A cancelled job stays cancelled after
   * the deletion is cancelled.
   */
  async cancelUnsubmittedWork(
    accountId: string,
    manager: EntityManager,
  ): Promise<{ artworks: number; promotions: number }> {
    const artworksToCancel = await manager.getRepository(AiArtworkEntity).find({
      where: {
        accountId,
        status: 'pending',
        providerRequestId: IsNull(),
      },
    });

    if (artworksToCancel.length > 0) {
      const artworkIds = artworksToCancel.map((a) => a.id);
      const jobIds = artworksToCancel.map((a) => a.processingJobId);

      await manager.getRepository(AiArtworkEntity).update(
        { id: In(artworkIds) },
        {
          status: 'cancelled',
          failureReason: 'account_deletion',
        },
      );

      await manager.getRepository(AiCreditReservationEntity).update(
        { processingJobId: In(jobIds) },
        { status: 'released' },
      );

      await manager.query(
        `UPDATE jobs.processing_jobs
         SET status = 'failed',
             error_message = $1,
             updated_at = now()
         WHERE id = ANY($2::uuid[])`,
        ['account_deletion', jobIds],
      );
    }

    const packagesToCancel = await manager.getRepository(PromotionTransferPackageEntity).find({
      where: {
        accountId,
        status: 'staged',
      },
    });

    for (const pkg of packagesToCancel) {
      await manager.getRepository(PromotionLockEntity).delete({ guestId: pkg.guestId });
      pkg.status = 'cancelled';
      await manager.save(PromotionTransferPackageEntity, pkg);
      await manager.delete(PromotionTransferPackageEntity, { guestId: pkg.guestId });
    }

    return {
      artworks: artworksToCancel.length,
      promotions: packagesToCancel.length,
    };
  }
}
