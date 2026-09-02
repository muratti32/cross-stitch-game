import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import { ConversionService } from '../conversion/conversion.service';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import { AI_ARTWORK_JOB_EVENT_NAME, AI_ARTWORK_JOB_TYPE } from '../jobs/jobs.constants';
import { AiCreditLedgerReason } from '../economy/entities/ai-credit-ledger-reason.enum';
import { ApproveAiArtworkDto } from './dto/approve-ai-artwork.dto';
import { CreateAiArtworkDto } from './dto/create-ai-artwork.dto';
import { AiArtworkEntity, AiCreditReservationEntity, type AiArtworkStatus } from './entities';
import { PromptModerationService } from './prompt-moderation.service';
import { FalArtworkProviderService, FalArtworkSubmissionRejectedError } from './fal-artwork-provider.service';
import { SupportReferenceService } from '../support/support-reference.service';
import { AccountStateService } from '../deletion/account-state.service';
import { AppConfigService } from '../config/app-config.service';
import { toCommerceOwnerPrincipal, type CommerceOwnerPrincipal } from '../economy/commerce-owner';
import { paidDebitUpdateExpression } from '../economy/paid-reserve';

// Statuses no delivery pass may act on: the artwork has either reached its
// outcome or lost its owner, so there is nothing left to copy or finalize.
const TERMINAL_ARTWORK_STATUSES: readonly AiArtworkStatus[] = ['delivered', 'failed', 'safety_rejected', 'deleted', 'cancelled'];

function isTerminalArtworkStatus(status: AiArtworkStatus): boolean {
  return TERMINAL_ARTWORK_STATUSES.includes(status);
}

@Injectable()
export class AiArtworkService {
  private readonly logger = new Logger(AiArtworkService.name);
  constructor(private readonly dataSource: DataSource, private readonly jobs: ProcessingJobsRepository, private readonly moderation: PromptModerationService, private readonly fal: FalArtworkProviderService, private readonly conversions: ConversionService, private readonly supportReferences: SupportReferenceService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, @InjectRepository(AiArtworkEntity) private readonly artworks: Repository<AiArtworkEntity>, private readonly accountStateService: AccountStateService, private readonly config: AppConfigService) {}
  async create(principal: AuthPrincipal, dto: CreateAiArtworkDto) {
    const owner = this.owner(principal); const status = await this.accountStatus(principal); if (status === 'closing') throw new ForbiddenException('Account is closing'); const prompt = dto.prompt.trim();
    if (!prompt) throw new UnprocessableEntityException('Prompt cannot be blank');
    await this.recordAttempt(owner);
    if (await this.moderation.isFlagged(prompt)) throw new UnprocessableEntityException('Prompt Safety Rejection');
    const id = randomUUID(); const jobId = randomUUID();
    const supportReference = await this.dataSource.transaction(async (m) => {
      const balances = await m.query<readonly { balance: string }[]>(`SELECT balance FROM economy.ai_credit_balances WHERE principal_type=$1 AND principal_id=$2 FOR UPDATE`, [owner.principalType, owner.principalId]);
      const balance = Number(balances[0]?.balance ?? 0);
      const holds = await m.query<readonly { holds: string }[]>(`SELECT COALESCE(count(*),0)::text AS holds FROM ai.ai_credit_reservations WHERE ${owner.principalType === 'account' ? 'account_id' : 'guest_installation_id'}=$1 AND status='reserved'`, [owner.principalId]);
      if (balance - Number(holds[0]?.holds ?? 0) < 1) throw new ConflictException('No available AI Credit');
      await this.jobs.createPendingWithOutboxFor(m, { id: jobId, eventName: AI_ARTWORK_JOB_EVENT_NAME, type: AI_ARTWORK_JOB_TYPE, payload: { artworkId: id } });
      await m.getRepository(AiCreditReservationEntity).save({ accountId: owner.principalType === 'account' ? owner.principalId : null, guestInstallationId: owner.principalType === 'guest' ? owner.principalId : null, processingJobId: jobId, status: 'reserved' });
      await m.getRepository(AiArtworkEntity).save({ id, accountId: owner.principalType === 'account' ? owner.principalId : null, guestInstallationId: owner.principalType === 'guest' ? owner.principalId : null, processingJobId: jobId, prompt, aspect: dto.aspect, status: 'pending', providerRequestKey: randomUUID(), providerRequestId: null, imageObjectKey: null, imageContentType: null, imageChecksum: null, imageByteLength: null, failureReason: null });
      return this.supportReferences.create(m, {
        principalId: owner.principalId,
        principalType: owner.principalType,
        records: [
          { id, type: 'ai_artwork' },
          { id: jobId, type: 'processing_job' },
        ],
      });
    });
    return { id, jobId, status: 'pending' as const, supportReference };
  }
  async list(principal: AuthPrincipal) { const status = await this.accountStatus(principal); if (status === 'closing') return []; const rows = await this.artworks.find({ where: this.ownerWhere(principal), order: { createdAt: 'DESC' } }); const visible = rows.filter((x) => x.status !== 'deleted'); const codes = await this.supportReferences.findCodesForRecords('ai_artwork', visible.map((x) => x.id)); return visible.map((x) => this.view(x, codes.get(x.id) ?? null)); }
  async getJob(principal: AuthPrincipal, id: string) { const status = await this.accountStatus(principal); if (status === 'closing') throw new NotFoundException('AI Artwork not found'); const a = await this.owned(principal, id); const job = await this.jobs.findById(a.processingJobId); if (!job) throw new NotFoundException(); const supportReference = await this.supportReferences.findCodeForRecord('ai_artwork', a.id); return { ...this.view(a, supportReference), jobStatus: job.status, errorMessage: job.errorMessage }; }
  async delete(principal: AuthPrincipal, id: string) { const a = await this.owned(principal, id); if (a.status === 'deleted') return; if (a.imageObjectKey) await this.storage.delete(a.imageObjectKey); await this.artworks.update({ id }, { status: 'deleted', imageObjectKey: null }); }
  async approve(principal: AuthPrincipal, id: string, dto: ApproveAiArtworkDto) { const status = await this.accountStatus(principal); if (status === 'closing') throw new ForbiddenException('Account is closing'); const a = await this.owned(principal, id); if (a.status !== 'delivered' || !a.imageObjectKey || !a.imageContentType) throw new ConflictException('Artwork is not ready for approval'); const bytes = await this.storage.get(a.imageObjectKey); if (!bytes) throw new ConflictException('Artwork bytes are unavailable'); return this.conversions.createPhotoConversion(principal, dto, { buffer: bytes, mimetype: a.imageContentType, size: bytes.length }); }
  async process(jobId: string): Promise<void> {
    const a = await this.artworks.findOneBy({ processingJobId: jobId }); if (!a) throw new Error('AI artwork input is missing');
    if (isTerminalArtworkStatus(a.status)) return;
    if (a.providerRequestId) { await this.reconcile(a.providerRequestId); return; }
    const base = this.config.falWebhookBaseUrl; const secret = this.config.falWebhookSecret;
    if (!base || !secret) throw new Error('fal.ai webhook is not configured');
    // A submit response can be lost after fal accepted the request. In that
    // ambiguous state we wait for the webhook instead of generating twice.
    if (a.status === 'submitting') return;
    await this.artworks.update({ id: a.id }, { status: 'submitting' });
    let requestId: string;
    try {
      requestId = await this.fal.submit(a.prompt, a.aspect, `${base.replace(/\/$/, '')}/v1/ai-artworks/fal/webhook?jobId=${jobId}&key=${a.providerRequestKey}&token=${encodeURIComponent(secret)}`);
    } catch (error: unknown) {
      if (error instanceof FalArtworkSubmissionRejectedError) {
        await this.release(a, 'failed', error.message);
        return;
      }
      throw error;
    }
    await this.attachRequest(jobId, requestId);
  }
  // An absent artwork is not an authentication failure: the row is already gone
  // for a closed account (the delivery is matched by tombstone in
  // handleVerifiedWebhook) or for a job that was deleted, and both of those used
  // to be accepted silently. Only a key that contradicts a row that does exist
  // is a rejection, which is the pre-archive behaviour of `webhook()`.
  async verifyWebhookKey(jobId: string, providerRequestKey: string): Promise<void> {
    const artwork = await this.artworks.findOneBy({ processingJobId: jobId });
    if (artwork !== null && artwork.providerRequestKey !== providerRequestKey) {
      throw new NotFoundException();
    }
  }
  async handleVerifiedWebhook(jobId: string, requestId: string): Promise<boolean> {
    const tombstoneExists = await this.dataSource.query<readonly { id: string }[]>(
      `SELECT id FROM deletion.provider_job_tombstones WHERE provider = 'fal.ai' AND provider_request_id = $1`,
      [requestId],
    );
    if (tombstoneExists.length > 0) {
      return true;
    }

    const artwork = await this.artworks.findOneBy({ processingJobId: jobId });
    if (!artwork) {
      return true;
    }
    const duplicate = artwork.providerRequestId === requestId && artwork.status !== 'submitting';
    await this.attachRequest(jobId, requestId);
    await this.reconcile(requestId);
    return duplicate;
  }

  async reconcile(requestId: string) {
    const tombstoneExists = await this.dataSource.query<readonly { id: string }[]>(
      `SELECT id FROM deletion.provider_job_tombstones WHERE provider = 'fal.ai' AND provider_request_id = $1`,
      [requestId],
    );
    if (tombstoneExists.length > 0) {
      return;
    }

    const a = await this.artworks.findOneBy({ providerRequestId: requestId });
    if (!a) {
      return;
    }
    // `deleted` and `cancelled` are as terminal as a delivery: the owner is
    // gone, so copying the provider output would resurrect an object `delete`
    // already removed and leave the row unfinalizable, retrying forever (#223).
    if (isTerminalArtworkStatus(a.status)) return;
    const result = await this.fal.result(requestId); if (!result) return;
    if (result.failed) return this.release(a, 'failed', 'fal.ai terminal failure');
    if (result.unsafe) return this.release(a, 'safety_rejected', 'Provider safety rejection');
    const image = await fetch(result.url); if (!image.ok) throw new Error('Could not copy fal.ai output'); const bytes = Buffer.from(await image.arrayBuffer()); const contentType = image.headers.get('content-type')?.split(';')[0] ?? 'image/png'; const key = `ai-artworks/${a.accountId ?? a.guestInstallationId}/${a.id}/source`;
    // The provider output for a given request never changes, so an object that
    // is already at the key is the copy an earlier pass wrote. Re-uploading it
    // is a Class A object storage write, and an artwork that never leaves
    // `submitted` repeats that write on every reconcile tick (issue #223).
    if (!(await this.storage.exists(key))) {
      await this.storage.put(key, bytes, contentType);
    }
    const finalized = await this.dataSource.transaction(async (m) => { const current = await m.getRepository(AiArtworkEntity).findOne({ where: { id: a.id }, lock: { mode: 'pessimistic_write' } }); if (!current || current.status !== 'submitted' || current.providerRequestId !== requestId) return false; await m.getRepository(AiArtworkEntity).update({ id: a.id }, { status: 'delivered', imageObjectKey: key, imageContentType: contentType, imageChecksum: createHash('sha256').update(bytes).digest('hex'), imageByteLength: String(bytes.length) }); await this.capture(m, current); await this.jobs.completeFromRunning(a.processingJobId, { artworkId: a.id }, m); return true; });
    // A pass that copied the output but could not finalize the row leaves the
    // artwork to be picked up again on the next tick, so surface it instead of
    // letting it retry silently forever.
    if (!finalized) {
      this.logger.warn(`AI Artwork ${a.id} was not finalized for provider request ${requestId} (status ${a.status})`);
    }
  }
  async reconcilePending() { const rows = await this.artworks.find({ where: { status: 'submitted' } }); for (const a of rows) if (a.providerRequestId) await this.reconcile(a.providerRequestId); }
  async failExhausted(jobId: string, reason: string) { const a = await this.artworks.findOneBy({ processingJobId: jobId }); if (a?.status === 'pending') await this.release(a, 'failed', reason); }
  private async attachRequest(jobId: string, requestId: string) { await this.dataSource.transaction(async (m) => { const a = await m.getRepository(AiArtworkEntity).findOne({ where: { processingJobId: jobId }, lock: { mode: 'pessimistic_write' } }); if (!a) throw new NotFoundException(); if (a.providerRequestId && a.providerRequestId !== requestId) throw new ConflictException('Provider request mismatch'); if (a.status === 'delivered' || a.status === 'failed' || a.status === 'safety_rejected' || a.status === 'deleted') return; await m.getRepository(AiArtworkEntity).update({ id: a.id }, { providerRequestId: requestId, status: 'submitted' }); }); }
  private async capture(m: EntityManager, artwork: AiArtworkEntity) { const r = await m.getRepository(AiCreditReservationEntity).findOne({ where: { processingJobId: artwork.processingJobId }, lock: { mode: 'pessimistic_write' } }); if (!r || r.status !== 'reserved') return; const principalType = artwork.accountId === null ? 'guest' : 'account'; const principalId = artwork.accountId ?? artwork.guestInstallationId; if (principalId === null) throw new Error('AI Artwork has no owner'); await m.query(`INSERT INTO economy.ai_credit_ledger_entries (principal_type, principal_id, amount, reason, source_key, granted, metadata) VALUES ($1,$2,-1,$3,$4,true,NULL) ON CONFLICT ON CONSTRAINT "UQ_ai_credit_ledger_entries_source_key" DO NOTHING`, [principalType, principalId, AiCreditLedgerReason.AiArtworkDelivery, `ai-artwork:${artwork.processingJobId}`]); await m.query(`INSERT INTO economy.ai_credit_balances (principal_type, principal_id, balance) VALUES ($1,$2,-1) ON CONFLICT ON CONSTRAINT "PK_ai_credit_balances" DO UPDATE SET balance=ai_credit_balances.balance-1, paid_balance=${paidDebitUpdateExpression('ai_credit_balances')}, updated_at=now()`, [principalType, principalId]); await m.getRepository(AiCreditReservationEntity).update({ id: r.id }, { status: 'captured' }); }
  private async release(a: AiArtworkEntity, status: 'failed' | 'safety_rejected', reason: string) { await this.dataSource.transaction(async (m) => { const r = await m.getRepository(AiCreditReservationEntity).findOne({ where: { processingJobId: a.processingJobId }, lock: { mode: 'pessimistic_write' } }); if (r?.status === 'reserved') await m.getRepository(AiCreditReservationEntity).update({ id: r.id }, { status: 'released' }); await m.getRepository(AiArtworkEntity).update({ id: a.id }, { status, failureReason: reason }); await this.jobs.failFromRunning(a.processingJobId, reason, m); }); }
  private async recordAttempt(owner: CommerceOwnerPrincipal) { await this.dataSource.transaction(async (m) => { const table = owner.principalType === 'account' ? 'auth.registered_accounts' : 'auth.guest_installations'; await m.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [owner.principalId]); const column = owner.principalType === 'account' ? 'account_id' : 'guest_installation_id'; const rows = await m.query<readonly { count: string }[]>(`SELECT count(*)::text AS count FROM ai.prompt_safety_attempts WHERE ${column}=$1 AND created_at > now() - interval '10 minutes'`, [owner.principalId]); if (Number(rows[0]?.count ?? 0) >= 10) throw new HttpException('AI generation rate limit reached', 429); await m.query(`INSERT INTO ai.prompt_safety_attempts (${column}) VALUES ($1)`, [owner.principalId]); }); }
  private owner(p: AuthPrincipal): CommerceOwnerPrincipal { return toCommerceOwnerPrincipal(p.type === PrincipalType.Account ? { type: 'account', accountId: p.id } : { type: 'guest', guestInstallationId: p.id }); }
  private async accountStatus(p: AuthPrincipal): Promise<'active' | 'closing' | 'closed' | 'deleted' | null> {
    // Guest Installations have only active/revoked status; reset and promotion
    // revoke the identity and its session before this service is reached, so
    // there is no Guest equivalent of an Account's recoverable closing state.
    return p.type === PrincipalType.Account ? this.accountStateService.getAccountStatus(p.id) : null;
  }
  private ownerWhere(p: AuthPrincipal): { accountId?: string; guestInstallationId?: string } { return p.type === PrincipalType.Account ? { accountId: p.id } : { guestInstallationId: p.id }; }
  private async owned(p: AuthPrincipal, id: string) { const a = await this.artworks.findOneBy({ id, ...this.ownerWhere(p) }); if (!a) throw new NotFoundException('AI Artwork not found'); return a; }
  private view(a: AiArtworkEntity, supportReference: string | null = null) { const exp = Math.floor(Date.now()/1000)+300; const sig = createHmac('sha256', this.config.grantSigningSecret).update(`${a.id}.${exp}`).digest('hex'); return { id: a.id, prompt: a.prompt, aspect: a.aspect, status: a.status, failureReason: a.failureReason, supportReference, createdAt: a.createdAt.toISOString(), imageUrl: a.status === 'delivered' ? `/v1/ai-artworks/images/${a.id}?exp=${exp}&sig=${sig}` : null }; }
  async image(id: string, exp: number, sig: string) { const expected = createHmac('sha256', this.config.grantSigningSecret).update(`${id}.${exp}`).digest('hex'); if (exp < Math.floor(Date.now()/1000) || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new ForbiddenException(); const a = await this.artworks.findOneBy({ id, status: 'delivered' }); if (!a?.imageObjectKey) throw new NotFoundException(); const bytes = await this.storage.get(a.imageObjectKey); if (!bytes) throw new NotFoundException(); return { bytes, contentType: a.imageContentType ?? 'image/png' }; }
}
