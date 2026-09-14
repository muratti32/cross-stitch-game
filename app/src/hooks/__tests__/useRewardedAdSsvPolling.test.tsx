import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchAdAttemptState } from '../../api/economy';
import { captureAdRewardVerificationError } from '../../observability/sentry';
import { useRewardedAdSsvPolling, type UseRewardedAdSsvPollingOptions } from '../useRewardedAdSsvPolling';

jest.mock('../../api/economy', () => ({ coinBalanceQueryKey: ['economy', 'balance'], rewardDayQueryKey: ['economy', 'reward-day'], fetchAdAttemptState: jest.fn() }));
jest.mock('../../api/membership', () => ({ membershipQueryKey: ['commerce', 'membership'] }));
jest.mock('../../observability/sentry', () => ({ captureAdRewardVerificationError: jest.fn() }));
const fetchState = fetchAdAttemptState as jest.MockedFunction<typeof fetchAdAttemptState>;

describe('useRewardedAdSsvPolling', () => {
  let queryClient: QueryClient;
  let renderer: TestRenderer.ReactTestRenderer | null;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-14T12:00:00Z'));
    jest.clearAllMocks();
    renderer = null;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => {
    await act(async () => { renderer?.unmount(); });
    jest.useRealTimers();
  });

  async function mount(options: UseRewardedAdSsvPollingOptions) {
    const holder: { current: ReturnType<typeof useRewardedAdSsvPolling> | null } = { current: null };
    function Harness() { holder.current = useRewardedAdSsvPolling(options); return null; }
    await act(async () => { renderer = TestRenderer.create(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>); });
    return () => {
      if (holder.current === null) throw new Error('hook not mounted');
      return holder.current;
    };
  }

  test('polls nonce and verifies independently of balance changes', async () => {
    const onVerified = jest.fn();
    fetchState.mockResolvedValue({ state: 'verified', expiresAt: '2026-09-14T12:05:00Z' });
    const current = await mount({ onVerified });
    act(() => current().startPolling('00000000-0000-4000-8000-000000000001', '2026-09-14T12:05:00Z'));
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    expect(fetchState).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  test('reports one transient error and continues until expiry', async () => {
    const onPending = jest.fn();
    fetchState.mockRejectedValue(new Error('network'));
    const current = await mount({ onPending });
    act(() => current().startPolling('nonce', '2026-09-14T12:00:03Z'));
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
    expect(fetchState.mock.calls.length).toBeGreaterThan(1);
    expect(captureAdRewardVerificationError).toHaveBeenCalledTimes(1);
    expect(onPending).toHaveBeenCalledTimes(1);
  });

  test('reports expiry instead of pending when the backend says the attempt expired', async () => {
    const onPending = jest.fn();
    const onExpired = jest.fn();
    fetchState.mockResolvedValue({ state: 'expired', expiresAt: '2026-09-14T11:59:00Z' });
    const current = await mount({ onPending, onExpired });
    act(() => current().startPolling('nonce', '2026-09-14T12:05:00Z'));
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onPending).not.toHaveBeenCalled();
    expect(current().isVerifying).toBe(false);
  });

  test('does not overlap a slow request', async () => {
    fetchState.mockImplementation(() => new Promise(() => undefined));
    const current = await mount({});
    act(() => current().startPolling('nonce', '2026-09-14T12:05:00Z'));
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(fetchState).toHaveBeenCalledTimes(1);
  });

  test('ignores an in-flight result after restart and unmount', async () => {
    let resolveFirst: ((value: { state: 'verified'; expiresAt: string }) => void) | undefined;
    fetchState.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    fetchState.mockResolvedValue({ state: 'pending', expiresAt: '2026-09-14T12:05:00Z' });
    const onVerified = jest.fn();
    const current = await mount({ onVerified });
    act(() => current().startPolling('old', '2026-09-14T12:05:00Z'));
    await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
    act(() => current().startPolling('new', '2026-09-14T12:05:00Z'));
    await act(async () => { resolveFirst?.({ state: 'verified', expiresAt: '2026-09-14T12:05:00Z' }); await Promise.resolve(); });
    expect(onVerified).not.toHaveBeenCalled();
    await act(async () => { renderer?.unmount(); });
    renderer = null;
    await act(async () => { await jest.runOnlyPendingTimersAsync(); });
    expect(onVerified).not.toHaveBeenCalled();
  });
});
