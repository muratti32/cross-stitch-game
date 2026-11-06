import type { PackagedSession, PromotionManifest, PromotionPreviewResponse } from '../../api/promotionContract';
import type { HandoffBase, PromotionHandoff } from '../handoff';

export const GUEST_ID = '11111111-1111-4111-8111-111111111111';
export const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
export const PATTERN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const PATTERN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SESSION_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export function manifest(overrides: Partial<PromotionManifest> = {}): PromotionManifest {
  return {
    progress: { [SESSION_A]: { deviceSeq: 4, checksum: 'sum' } },
    completions: { [PATTERN_A]: '2026-02-01T10:00:00.000Z' },
    pendingRewards: {},
    likes: { [PATTERN_B]: true },
    ...overrides,
  };
}

export function packaged(overrides: Partial<PackagedSession> = {}): PackagedSession {
  return {
    key: SESSION_A,
    localSessionId: 'session_local_1',
    remoteSessionId: SESSION_A,
    patternId: PATTERN_A,
    source: 'catalog',
    artifactChecksum: 'artifact',
    status: 'active',
    createdAt: '2026-02-01T09:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    completedAt: null,
    replayOf: null,
    title: 'Rose',
    previewUrl: null,
    thumbnailUrl: null,
    patternWidth: 4,
    patternHeight: 4,
    packedBitmapBase64: 'Bw==',
    ...overrides,
  };
}

export function base(overrides: Partial<HandoffBase> = {}): HandoffBase {
  return {
    guestId: GUEST_ID,
    accountId: ACCOUNT_ID,
    manifest: manifest(),
    manifestChecksum: 'checksum-1',
    drain: { likes: [PATTERN_B], sessions: [{ guestSessionId: SESSION_A, patternId: PATTERN_A, serverKnown: true }] },
    sessions: [packaged()],
    ...overrides,
  };
}

export function preview(overrides: Partial<PromotionPreviewResponse> = {}): PromotionPreviewResponse {
  return {
    guestId: GUEST_ID,
    accountId: ACCOUNT_ID,
    promotionMode: 'economy',
    manifestChecksum: 'checksum-1',
    guestLedgerBalance: 120,
    guestUnlockCount: 2,
    pendingAdAttemptCount: 1,
    validatedPendingRewards: [],
    rejectedPendingRewards: {},
    dispositions: {
      coinBalance: 'transfer',
      pendingRewards: 'validate',
      progress: 'transfer',
      completions: 'transfer',
      likes: 'transfer',
    },
    expiry: '2026-02-01T10:05:00.000Z',
    signature: 'sig',
    paidCommerce: 'none',
    ...overrides,
  };
}

export const emptyPreview = (): PromotionPreviewResponse =>
  preview({ guestLedgerBalance: 0, guestUnlockCount: 0, pendingAdAttemptCount: 0, validatedPendingRewards: [] });

export const emptyManifest = (): PromotionManifest => ({ progress: {}, completions: {}, pendingRewards: {}, likes: {} });

export function captured(overrides: Partial<HandoffBase> = {}): PromotionHandoff {
  return { ...base(overrides), phase: 'captured' };
}
