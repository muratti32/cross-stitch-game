import { Injectable, NotFoundException, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomUUID } from 'crypto';

import { AppConfigService } from '../config/app-config.service';
import { GuestInstallationsRepository } from '../auth/guest-installations.repository';
import { AuthHashingService } from '../auth/auth-hashing.service';
import { PromotionLockEntity, PromotionTransferPackageEntity } from './entities';
import { CoinBalanceEntity, CoinLedgerEntryEntity } from '../economy/entities';
import { PromotionPreviewRequestDto } from './dto/promotion-preview.dto';
import { PromotionPackageRequestDto } from './dto/promotion-package.dto';

@Injectable()
export class PromotionService {
  constructor(
    private readonly config: AppConfigService,
    private readonly authHashing: AuthHashingService,
    private readonly guestInstallationsRepo: GuestInstallationsRepository,
    @InjectRepository(PromotionLockEntity)
    private readonly lockRepo: Repository<PromotionLockEntity>,
    @InjectRepository(PromotionTransferPackageEntity)
    private readonly transferPackageRepo: Repository<PromotionTransferPackageEntity>,
    @InjectRepository(CoinBalanceEntity)
    private readonly coinBalanceRepo: Repository<CoinBalanceEntity>,
    @InjectRepository(CoinLedgerEntryEntity)
    private readonly coinLedgerEntryRepo: Repository<CoinLedgerEntryEntity>,
  ) {}

  async generatePreview(accountId: string, dto: PromotionPreviewRequestDto) {
    const { guestId, guestCredential, manifest, manifestChecksum } = dto;

    // 1. Authenticate guest
    const guest = await this.guestInstallationsRepo.findOneById(guestId);
    if (!guest) {
      throw new NotFoundException('Guest installation not found');
    }
    const isCredValid = await this.authHashing.verifyCredentialSecret(guestCredential, guest.credentialHash);
    if (!isCredValid) {
      throw new UnauthorizedException('Invalid guest credentials');
    }
    if (guest.status === 'revoked') {
      throw new ConflictException('Guest installation has already been consumed');
    }

    // 2. Determine if target account has already performed Guest Economy Promotion
    const count = await this.transferPackageRepo.count({
      where: { accountId, status: 'committed' }
    });
    const hasPromotedEconomy = count > 0;
    const promotionMode = hasPromotedEconomy ? 'data-only' : 'economy';

    // 3. Get Guest Coin Balance
    const guestBalanceRow = await this.coinBalanceRepo.findOne({
      where: { principalType: 'guest', principalId: guestId }
    });
    const guestLedgerBalance = guestBalanceRow ? Number(guestBalanceRow.balance) : 0;

    // 4. Validate Pending Coin Rewards
    const validatedPendingRewards: string[] = [];
    const rejectedPendingRewards: Record<string, string> = {};

    if (manifest.pendingRewards) {
      for (const [sourceKey, _evidence] of Object.entries(manifest.pendingRewards)) {
        // Check if this sourceKey already exists in the coin ledger
        const existing = await this.coinLedgerEntryRepo.findOne({
          where: { sourceKey }
        });
        if (existing) {
          rejectedPendingRewards[sourceKey] = 'already_granted';
          continue;
        }

        validatedPendingRewards.push(sourceKey);
      }
    }

    // 5. Preview dispositions itemization
    const dispositions = {
      coinBalance: promotionMode === 'economy' ? 'transfer' : 'discard',
      pendingRewards: promotionMode === 'economy' ? 'validate' : 'discard',
      progress: 'transfer',
      completions: 'transfer',
      likes: 'transfer',
    };

    // Short-lived preview duration (5 minutes)
    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    // Cryptographic signature
    const signatureData = {
      guestId,
      accountId,
      manifestChecksum,
      promotionMode,
      guestLedgerBalance,
      expiry: expiry.toISOString(),
    };
    const signature = this.signData(signatureData);

    return {
      guestId,
      accountId,
      promotionMode,
      manifestChecksum,
      guestLedgerBalance,
      validatedPendingRewards,
      rejectedPendingRewards,
      dispositions,
      expiry: expiry.toISOString(),
      signature,
    };
  }

  async acquireLock(accountId: string, previewSignature: string, previewData: any) {
    // 1. Verify preview signature
    const isValid = this.verifySignature(previewData, previewSignature);
    if (!isValid) {
      throw new BadRequestException('Invalid preview signature or preview has been modified');
    }

    // 2. Verify preview has not expired
    if (new Date(previewData.expiry) < new Date()) {
      throw new BadRequestException('Preview has expired');
    }

    // 3. Verify target account matches authenticated user
    if (previewData.accountId !== accountId) {
      throw new UnauthorizedException('Account mismatch');
    }

    const guestId = previewData.guestId;

    // 4. Acquire single short-lived lock (Promotion Commit Lock)
    // Delete any expired lock for this guest first
    await this.lockRepo.delete({ guestId });

    const lock = new PromotionLockEntity();
    lock.guestId = guestId;
    lock.token = randomUUID();
    lock.expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes lock lease
    await this.lockRepo.save(lock);

    return {
      lockToken: lock.token,
      expiry: lock.expiry.toISOString(),
    };
  }

  async stagePackage(accountId: string, dto: PromotionPackageRequestDto) {
    const { guestId, lockToken, manifestChecksum, packageData, checksum } = dto;

    // 1. Verify active lock exists and token matches
    const lock = await this.lockRepo.findOne({ where: { guestId } });
    if (!lock || lock.token !== lockToken || lock.expiry < new Date()) {
      throw new ConflictException('Active promotion commit lock not found or expired');
    }

    // 2. Save/Stage the Promotion Transfer Package in PostgreSQL
    // Delete any existing package for this guest (clean up previous attempts)
    await this.transferPackageRepo.delete({ guestId });

    const pkg = new PromotionTransferPackageEntity();
    pkg.guestId = guestId;
    pkg.accountId = accountId;
    pkg.manifestChecksum = manifestChecksum;
    pkg.packageData = packageData;
    pkg.checksum = checksum;
    pkg.expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry
    pkg.status = 'staged';
    await this.transferPackageRepo.save(pkg);

    return {
      status: 'staged',
      expiry: pkg.expiry.toISOString(),
    };
  }

  async cancelPromotion(accountId: string, guestId: string) {
    // Verify package belongs to this account
    const pkg = await this.transferPackageRepo.findOne({ where: { guestId, accountId } });
    
    // Release the lock
    await this.lockRepo.delete({ guestId });

    if (pkg) {
      pkg.status = 'cancelled';
      await this.transferPackageRepo.save(pkg);
      await this.transferPackageRepo.delete({ guestId });
    }

    return { status: 'cancelled' };
  }

  async assertNotLocked(principalId: string, principalType: string): Promise<void> {
    if (principalType !== 'guest') return;
    const activeLock = await this.lockRepo.findOne({
      where: { guestId: principalId }
    });
    if (activeLock && activeLock.expiry > new Date()) {
      throw new ConflictException('Guest ledger is locked due to promotion in progress');
    }
  }

  private signData(data: any): string {
    const payload = JSON.stringify(data);
    return createHmac('sha256', this.config.jwtSecret).update(payload).digest('hex');
  }

  private verifySignature(data: any, signature: string): boolean {
    const expected = this.signData(data);
    return expected === signature;
  }
}
