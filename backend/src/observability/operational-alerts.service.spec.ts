import { Repository } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { OperationalAlertRunEntity } from './entities';
import { OperationalAlertsEvaluatorService } from './operational-alerts-evaluator.service';
import { OperationalAlertsService } from './operational-alerts.service';
import { captureOperationalAlert } from './sentry';
import type {
  OperationalAlertSignal,
  OperationalAlertsEvaluation,
} from './operational-alerts.types';

jest.mock('./sentry', () => ({
  captureOperationalAlert: jest.fn(),
  isSentryEnabled: true,
}));

const captureMock = captureOperationalAlert as jest.MockedFunction<
  typeof captureOperationalAlert
>;

const COOLDOWN_SECONDS = 600;

function evaluation(
  evaluatedAt: Date,
  breached: readonly OperationalAlertSignal[],
): OperationalAlertsEvaluation {
  const signal = (name: OperationalAlertSignal) => ({
    breached: breached.includes(name),
    signal: name,
    threshold: 5,
    value: breached.includes(name) ? 9 : 1,
  });
  return {
    evaluatedAt,
    promotionNeedsAttention: signal('promotion_needs_attention'),
    queueDepth: signal('queue_depth'),
    stuckJobs: signal('stuck_jobs'),
    webhookFailures: signal('webhook_failures'),
  };
}

function buildService(evaluateAll: jest.Mock) {
  const saved: Partial<OperationalAlertRunEntity>[] = [];
  const runs = {
    create: jest.fn((input: Partial<OperationalAlertRunEntity>) => input),
    save: jest.fn(async (input: Partial<OperationalAlertRunEntity>) => {
      saved.push(input);
      return input as OperationalAlertRunEntity;
    }),
  } as unknown as Repository<OperationalAlertRunEntity>;
  const config = {
    operationalAlertsCooldownSeconds: COOLDOWN_SECONDS,
  } as AppConfigService;
  const service = new OperationalAlertsService(
    { evaluateAll } as unknown as OperationalAlertsEvaluatorService,
    config,
    runs,
  );
  return { saved, service };
}

describe('OperationalAlertsService', () => {
  beforeEach(() => {
    captureMock.mockClear();
  });

  it('raises one alert per breached signal and records the run', async () => {
    const at = new Date('2026-07-25T12:00:00.000Z');
    const { saved, service } = buildService(
      jest.fn().mockResolvedValue(evaluation(at, ['queue_depth', 'stuck_jobs'])),
    );

    await service.runOnce(at);

    expect(captureMock).toHaveBeenCalledTimes(2);
    expect(captureMock).toHaveBeenCalledWith(
      expect.stringContaining('queue depth'),
      'warning',
      'operational-alert:queue_depth',
      { signal: 'queue_depth', threshold: 5, value: 9 },
    );
    expect(captureMock).toHaveBeenCalledWith(
      expect.stringContaining('stuck Processing Jobs'),
      'error',
      'operational-alert:stuck_jobs',
      expect.objectContaining({ signal: 'stuck_jobs' }),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(
      expect.objectContaining({ queueDepthBreached: true, queueDepthValue: 9 }),
    );
  });

  it('does not re-alert a still-breached signal before the cooldown elapses', async () => {
    const first = new Date('2026-07-25T12:00:00.000Z');
    const second = new Date(first.getTime() + (COOLDOWN_SECONDS - 1) * 1000);
    const evaluateAll = jest
      .fn()
      .mockImplementation(async (now: Date) => evaluation(now, ['queue_depth']));
    const { service } = buildService(evaluateAll);

    await service.runOnce(first);
    await service.runOnce(second);

    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it('re-alerts a still-breached signal once the cooldown has elapsed', async () => {
    const first = new Date('2026-07-25T12:00:00.000Z');
    const second = new Date(first.getTime() + COOLDOWN_SECONDS * 1000);
    const evaluateAll = jest
      .fn()
      .mockImplementation(async (now: Date) => evaluation(now, ['queue_depth']));
    const { service } = buildService(evaluateAll);

    await service.runOnce(first);
    await service.runOnce(second);

    expect(captureMock).toHaveBeenCalledTimes(2);
  });

  it('stops alerting when the condition clears and alerts again on a fresh breach', async () => {
    const first = new Date('2026-07-25T12:00:00.000Z');
    const cleared = new Date(first.getTime() + 60_000);
    const rebreached = new Date(first.getTime() + 120_000);
    const evaluateAll = jest.fn().mockImplementation(async (now: Date) =>
      evaluation(now, now.getTime() === cleared.getTime() ? [] : ['queue_depth']),
    );
    const { service } = buildService(evaluateAll);

    await service.runOnce(first);
    await service.runOnce(cleared);
    expect(captureMock).toHaveBeenCalledTimes(1);

    // A fresh breach alerts immediately even inside the cooldown window,
    // because clearing resets the signal's dedupe state.
    await service.runOnce(rebreached);
    expect(captureMock).toHaveBeenCalledTimes(2);
  });

  it('contains a failing pass instead of throwing into the worker loop', async () => {
    const { saved, service } = buildService(
      jest.fn().mockRejectedValue(new Error('database is down')),
    );

    await expect(service.runOnce(new Date('2026-07-25T12:00:00.000Z'))).resolves.toBeNull();
    expect(captureMock).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });
});
