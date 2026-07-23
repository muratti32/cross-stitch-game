import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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
import { AiArtworkEntity, AiCreditReservationEntity } from './entities';
import { PromptModerationService } from './prompt-moderation.service';
import { FalArtworkProviderService, FalArtworkSubmissionRejectedError } from './fal-artwork-provider.service';

@Injectable()
export class AiArtworkService {
  constructor(private readonly dataSource: DataSource, private readonly jobs: ProcessingJobsRepository, private readonly moderation: PromptModerationService, private readonly fal: FalArtworkProviderService, private readonly conversions: ConversionService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage, @InjectRepository(AiArtworkEntity) private readonly artworks: Repository<AiArtworkEntity>) {}
  async create(principal: AuthPrincipal, dto: CreateAiArtworkDto) {
    const accountId = this.account(principal); const prompt = dto.prompt.trim();
    if (!prompt) throw new UnprocessableEntityException('Prompt cannot be blank');
    await this.recordAttempt(accountId);
    if (await this.moderation.isFlagged(prompt)) throw new UnprocessableEntityException('Prompt Safety Rejection');
    const id = randomUUID(); const jobId = randomUUID();
    await this.dataSource.transaction(async (m) => {
      const balances = await m.query<readonly { balance: string }[]>(`SELECT balance FROM economy.ai_credit_balances WHERE principal_type='account' AND principal_id=$1 FOR UPDATE`, [accountId]);
      const balance = Number(balances[0]?.balance ?? 0);
      const holds = await m.query<readonly { holds: string }[]>(`SELECT COALESCE(count(*),0)::text AS holds FROM ai.ai_credit_reservations WHERE account_id=$1 AND status='reserved'`, [accountId]);
      if (balance - Number(holds[0]?.holds ?? 0) < 1) throw new ConflictException('No available AI Credit');
      await this.jobs.createPendingWithOutboxFor(m, { id: jobId, eventName: AI_ARTWORK_JOB_EVENT_NAME, type: AI_ARTWORK_JOB_TYPE, payload: { artworkId: id } });
      await m.getRepository(AiCreditReservationEntity).save({ accountId, processingJobId: jobId, status: 'reserved' });
      await m.getRepository(AiArtworkEntity).save({ id, accountId, processingJobId: jobId, prompt, aspect: dto.aspect, status: 'pending', providerRequestKey: randomUUID(), providerRequestId: null, imageObjectKey: null, imageContentType: null, imageChecksum: null, imageByteLength: null, failureReason: null });
    });
    return { id, jobId, status: 'pending' as const };
  }
  async list(principal: AuthPrincipal) { const accountId = this.account(principal); const rows = await this.artworks.find({ where: { accountId }, order: { createdAt: 'DESC' } }); return rows.filter((x) => x.status !== 'deleted').map((x) => this.view(x)); }
  async getJob(principal: AuthPrincipal, id: string) { const a = await this.owned(principal, id); const job = await this.jobs.findById(a.processingJobId); if (!job) throw new NotFoundException(); return { ...this.view(a), jobStatus: job.status, errorMessage: job.errorMessage }; }
  async delete(principal: AuthPrincipal, id: string) { const a = await this.owned(principal, id); if (a.status === 'deleted') return; if (a.imageObjectKey) await this.storage.delete(a.imageObjectKey); await this.artworks.update({ id }, { status: 'deleted', imageObjectKey: null }); }
  async approve(principal: AuthPrincipal, id: string, dto: ApproveAiArtworkDto) { const a = await this.owned(principal, id); if (a.status !== 'delivered' || !a.imageObjectKey || !a.imageContentType) throw new ConflictException('Artwork is not ready for approval'); const bytes = await this.storage.get(a.imageObjectKey); if (!bytes) throw new ConflictException('Artwork bytes are unavailable'); return this.conversions.createPhotoConversion(principal, dto, { buffer: bytes, mimetype: a.imageContentType, size: bytes.length }); }
  async process(jobId: string): Promise<void> {
    const a = await this.artworks.findOneBy({ processingJobId: jobId }); if (!a) throw new Error('AI artwork input is missing');
    if (a.status === 'delivered' || a.status === 'safety_rejected' || a.status === 'failed') return;
    if (a.providerRequestId) { await this.reconcile(a.providerRequestId); return; }
    const base = process.env.FAL_WEBHOOK_BASE_URL; const secret = process.env.FAL_WEBHOOK_SECRET;
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
  async webhook(jobId: string, providerRequestKey: string, requestId: string) { const artwork = await this.artworks.findOneBy({ processingJobId: jobId }); if (!artwork || artwork.providerRequestKey !== providerRequestKey) throw new NotFoundException(); await this.attachRequest(jobId, requestId); await this.reconcile(requestId); }
  async reconcile(requestId: string) {
    const a = await this.artworks.findOneBy({ providerRequestId: requestId }); if (!a || a.status === 'delivered' || a.status === 'failed' || a.status === 'safety_rejected') return;
    const result = await this.fal.result(requestId); if (!result) return;
    if (result.failed) return this.release(a, 'failed', 'fal.ai terminal failure');
    if (result.unsafe) return this.release(a, 'safety_rejected', 'Provider safety rejection');
    const image = await fetch(result.url); if (!image.ok) throw new Error('Could not copy fal.ai output'); const bytes = Buffer.from(await image.arrayBuffer()); const contentType = image.headers.get('content-type')?.split(';')[0] ?? 'image/png'; const key = `ai-artworks/${a.accountId}/${a.id}/source`;
    await this.storage.put(key, bytes, contentType);
    await this.dataSource.transaction(async (m) => { const current = await m.getRepository(AiArtworkEntity).findOne({ where: { id: a.id }, lock: { mode: 'pessimistic_write' } }); if (!current || current.status !== 'submitted' || current.providerRequestId !== requestId) return; await m.getRepository(AiArtworkEntity).update({ id: a.id }, { status: 'delivered', imageObjectKey: key, imageContentType: contentType, imageChecksum: createHash('sha256').update(bytes).digest('hex'), imageByteLength: String(bytes.length) }); await this.capture(m, current); await this.jobs.completeFromRunning(a.processingJobId, { artworkId: a.id }, m); });
  }
  async reconcilePending() { const rows = await this.artworks.find({ where: { status: 'submitted' } }); for (const a of rows) if (a.providerRequestId) await this.reconcile(a.providerRequestId); }
  async failExhausted(jobId: string, reason: string) { const a = await this.artworks.findOneBy({ processingJobId: jobId }); if (a?.status === 'pending') await this.release(a, 'failed', reason); }
  private async attachRequest(jobId: string, requestId: string) { await this.dataSource.transaction(async (m) => { const a = await m.getRepository(AiArtworkEntity).findOne({ where: { processingJobId: jobId }, lock: { mode: 'pessimistic_write' } }); if (!a) throw new NotFoundException(); if (a.providerRequestId && a.providerRequestId !== requestId) throw new ConflictException('Provider request mismatch'); if (a.status === 'delivered' || a.status === 'failed' || a.status === 'safety_rejected' || a.status === 'deleted') return; await m.getRepository(AiArtworkEntity).update({ id: a.id }, { providerRequestId: requestId, status: 'submitted' }); }); }
  private async capture(m: EntityManager, artwork: AiArtworkEntity) { const r = await m.getRepository(AiCreditReservationEntity).findOne({ where: { processingJobId: artwork.processingJobId }, lock: { mode: 'pessimistic_write' } }); if (!r || r.status !== 'reserved') return; await m.query(`INSERT INTO economy.ai_credit_ledger_entries (principal_type, principal_id, amount, reason, source_key, granted, metadata) VALUES ('account',$1,-1,$2,$3,true,NULL)`, [artwork.accountId, AiCreditLedgerReason.AiArtworkDelivery, `ai-artwork:${artwork.processingJobId}`]); await m.query(`INSERT INTO economy.ai_credit_balances (principal_type, principal_id, balance) VALUES ('account',$1,-1) ON CONFLICT ON CONSTRAINT "PK_ai_credit_balances" DO UPDATE SET balance=economy.ai_credit_balances.balance-1, updated_at=now()`, [artwork.accountId]); await m.getRepository(AiCreditReservationEntity).update({ id: r.id }, { status: 'captured' }); }
  private async release(a: AiArtworkEntity, status: 'failed' | 'safety_rejected', reason: string) { await this.dataSource.transaction(async (m) => { const r = await m.getRepository(AiCreditReservationEntity).findOne({ where: { processingJobId: a.processingJobId }, lock: { mode: 'pessimistic_write' } }); if (r?.status === 'reserved') await m.getRepository(AiCreditReservationEntity).update({ id: r.id }, { status: 'released' }); await m.getRepository(AiArtworkEntity).update({ id: a.id }, { status, failureReason: reason }); await this.jobs.failFromRunning(a.processingJobId, reason, m); }); }
  private async recordAttempt(accountId: string) { await this.dataSource.transaction(async (m) => { await m.query('SELECT id FROM auth.registered_accounts WHERE id=$1 FOR UPDATE', [accountId]); const rows = await m.query<readonly { count: string }[]>(`SELECT count(*)::text AS count FROM ai.prompt_safety_attempts WHERE account_id=$1 AND created_at > now() - interval '10 minutes'`, [accountId]); if (Number(rows[0]?.count ?? 0) >= 10) throw new HttpException('AI generation rate limit reached', 429); await m.query('INSERT INTO ai.prompt_safety_attempts (account_id) VALUES ($1)', [accountId]); }); }
  private account(p: AuthPrincipal) { if (p.type !== PrincipalType.Account) throw new ForbiddenException('Registered Account required'); return p.id; }
  private async owned(p: AuthPrincipal, id: string) { const a = await this.artworks.findOneBy({ id }); if (!a || a.accountId !== this.account(p)) throw new NotFoundException('AI Artwork not found'); return a; }
  private view(a: AiArtworkEntity) { const exp = Math.floor(Date.now()/1000)+300; const sig = createHmac('sha256', process.env.GRANT_SIGNING_SECRET ?? '').update(`${a.id}.${exp}`).digest('hex'); return { id: a.id, aspect: a.aspect, status: a.status, failureReason: a.failureReason, createdAt: a.createdAt.toISOString(), imageUrl: a.status === 'delivered' ? `/v1/ai-artworks/images/${a.id}?exp=${exp}&sig=${sig}` : null }; }
  async image(id: string, exp: number, sig: string) { const expected = createHmac('sha256', process.env.GRANT_SIGNING_SECRET ?? '').update(`${id}.${exp}`).digest('hex'); if (exp < Math.floor(Date.now()/1000) || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new ForbiddenException(); const a = await this.artworks.findOneBy({ id, status: 'delivered' }); if (!a?.imageObjectKey) throw new NotFoundException(); const bytes = await this.storage.get(a.imageObjectKey); if (!bytes) throw new NotFoundException(); return { bytes, contentType: a.imageContentType ?? 'image/png' }; }
}
