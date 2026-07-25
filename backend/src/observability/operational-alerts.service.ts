import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { OperationalAlertRunEntity } from './entities';
import { OperationalAlertsEvaluatorService } from './operational-alerts-evaluator.service';
import { captureOperationalAlert } from './sentry';
import { scrubWebhookPayload } from './sentry-scrubber';
import type {
  OperationalAlertSignal,
  OperationalAlertSignalResult,
  OperationalAlertsEvaluation,
} from './operational-alerts.types';

interface SignalDedupeState {
  breachedSince: Date | null;
  lastAlertedAt: Date | null;
}

const SIGNAL_LABELS: Readonly<Record<OperationalAlertSignal, string>> = {
  promotion_needs_attention: 'Promotion Needs Attention',
  queue_depth: 'queue depth',
  stuck_jobs: 'stuck Processing Jobs',
  webhook_failures: 'webhook processing failures',
};

// webhook_failures and stuck_jobs indicate something is actively broken right
// now; queue_depth and promotion_needs_attention indicate a backlog building
// up, which is usually recoverable without paging urgency.
const SIGNAL_LEVELS: Readonly<Record<OperationalAlertSignal, 'warning' | 'error'>> = {
  promotion_needs_attention: 'warning',
  queue_depth: 'warning',
  stuck_jobs: 'error',
  webhook_failures: 'error',
};

/**
 * Schedules and dedupes the #63 operational alert evaluation. In-memory
 * dedupe state is per worker process by design (ticket requirement): a fresh
 * process (a restart, or the separate API process reading via the Admin
 * API) starts clean and may re-alert once on a still-breached signal, which
 * is preferable to losing alerts across a restart.
 */
@Injectable()
export class OperationalAlertsService {
  private readonly logger = new Logger(OperationalAlertsService.name);
  private readonly dedupeState = new Map<OperationalAlertSignal, SignalDedupeState>();

  constructor(
    private readonly evaluator: OperationalAlertsEvaluatorService,
    private readonly config: AppConfigService,
    @InjectRepository(OperationalAlertRunEntity)
    private readonly runs: Repository<OperationalAlertRunEntity>,
  ) {}

  /**
   * Evaluates all four signals, raises/dedupes alerts, and persists the run
   * so the Admin API (a separate deployable/process from the worker that
   * schedules this) can read the latest evaluation. Never throws: a failure
   * anywhere in the pass is logged and swallowed so the worker's scheduling
   * loop is never at risk of crashing on this.
   */
  async runOnce(now: Date = new Date()): Promise<OperationalAlertsEvaluation | null> {
    try {
      const evaluation = await this.evaluator.evaluateAll(now);
      for (const result of [
        evaluation.queueDepth,
        evaluation.webhookFailures,
        evaluation.stuckJobs,
        evaluation.promotionNeedsAttention,
      ]) {
        this.processSignal(result, now);
      }
      await this.persist(evaluation);
      return evaluation;
    } catch (error: unknown) {
      this.logger.error(
        `Error evaluating operational alerts: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  private processSignal(result: OperationalAlertSignalResult, now: Date): void {
    const state = this.dedupeState.get(result.signal) ?? {
      breachedSince: null,
      lastAlertedAt: null,
    };

    if (!result.breached) {
      if (state.breachedSince !== null) {
        this.logger.log(
          `Operational alert cleared: ${SIGNAL_LABELS[result.signal]} (value ${result.value}, threshold ${result.threshold})`,
        );
      }
      this.dedupeState.set(result.signal, { breachedSince: null, lastAlertedAt: null });
      return;
    }

    const cooldownMs = this.config.operationalAlertsCooldownSeconds * 1000;
    const isNewBreach = state.breachedSince === null;
    const cooldownElapsed =
      state.lastAlertedAt === null ||
      now.getTime() - state.lastAlertedAt.getTime() >= cooldownMs;

    if (isNewBreach || cooldownElapsed) {
      this.raiseAlert(result);
      this.dedupeState.set(result.signal, {
        breachedSince: state.breachedSince ?? now,
        lastAlertedAt: now,
      });
    } else {
      this.dedupeState.set(result.signal, state);
    }
  }

  private raiseAlert(result: OperationalAlertSignalResult): void {
    // No player identifiers or free text of our own choosing here - only
    // counts and the signal name - but this still runs through the shared
    // scrubber (ADR-0035) before it reaches the Sentry pipeline, matching
    // every other path that leaves the backend with operator-visible data.
    const context = scrubWebhookPayload({
      signal: result.signal,
      threshold: result.threshold,
      value: result.value,
    }) as Record<string, unknown>;

    captureOperationalAlert(
      `Operational alert: ${SIGNAL_LABELS[result.signal]} breached (value ${result.value}, threshold ${result.threshold})`,
      SIGNAL_LEVELS[result.signal],
      `operational-alert:${result.signal}`,
      context,
    );
  }

  private async persist(evaluation: OperationalAlertsEvaluation): Promise<void> {
    await this.runs.save(
      this.runs.create({
        evaluatedAt: evaluation.evaluatedAt,
        promotionNeedsAttentionBreached: evaluation.promotionNeedsAttention.breached,
        promotionNeedsAttentionThreshold: evaluation.promotionNeedsAttention.threshold,
        promotionNeedsAttentionValue: evaluation.promotionNeedsAttention.value,
        queueDepthBreached: evaluation.queueDepth.breached,
        queueDepthThreshold: evaluation.queueDepth.threshold,
        queueDepthValue: evaluation.queueDepth.value,
        stuckJobsBreached: evaluation.stuckJobs.breached,
        stuckJobsThreshold: evaluation.stuckJobs.threshold,
        stuckJobsValue: evaluation.stuckJobs.value,
        webhookFailuresBreached: evaluation.webhookFailures.breached,
        webhookFailuresThreshold: evaluation.webhookFailures.threshold,
        webhookFailuresValue: evaluation.webhookFailures.value,
      }),
    );
  }
}
