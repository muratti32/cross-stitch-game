import { Injectable } from '@nestjs/common';
import { ProcessingJobNotReadyError } from '../jobs/demo-job-consumer.service';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import { AI_ARTWORK_JOB_TYPE } from '../jobs/jobs.constants';
import { AiArtworkService } from './ai-artwork.service';

@Injectable()
export class AiArtworkJobConsumerService {
  constructor(private readonly jobs: ProcessingJobsRepository, private readonly ai: AiArtworkService) {}
  async processDelivery(id: string) { const claim = await this.jobs.claimForWorker(id); if (claim.kind === 'missing') throw new Error(`Missing AI artwork job ${id}`); if (claim.kind === 'retry') throw new ProcessingJobNotReadyError(id); if (claim.kind === 'terminal') return { outcome: 'terminal-replay' as const, processingJobId: id }; if (claim.job.type !== AI_ARTWORK_JOB_TYPE) throw new Error('Unexpected AI artwork job type'); await this.ai.process(id); return { outcome: claim.kind === 'resume' ? 'resumed-and-completed' as const : 'completed' as const, processingJobId: id }; }
  failExhausted(id: string, reason: string) { return this.ai.failExhausted(id, reason); }
}
