import { apiFetch } from './apiFetch';
import { getLocalPatternLikes, setLocalPatternLike } from '../local-db';

export interface PromotionManifest {
  progress: Record<string, { deviceSeq: number; checksum: string }>;
  completions: Record<string, string>;
  pendingRewards: Record<string, any>;
  likes: Record<string, boolean>;
}

export interface PromotionPreviewRequest {
  guestId: string;
  guestCredential: string;
  manifest: PromotionManifest;
  manifestChecksum: string;
}

export interface PromotionPreviewResponse {
  guestId: string;
  accountId: string;
  promotionMode: 'economy' | 'data-only';
  manifestChecksum: string;
  guestLedgerBalance: number;
  validatedPendingRewards: string[];
  rejectedPendingRewards: Record<string, string>;
  dispositions: {
    coinBalance: 'transfer' | 'discard';
    pendingRewards: 'validate' | 'discard';
    progress: 'transfer';
    completions: 'transfer';
    likes: 'transfer';
  };
  expiry: string;
  signature: string;
}

export interface PromotionLockResponse {
  lockToken: string;
  expiry: string;
}

export interface PromotionPackageRequest {
  guestId: string;
  lockToken: string;
  manifestChecksum: string;
  packageData: any;
  checksum: string;
}

export async function preparePromotionManifest(): Promise<PromotionManifest> {
  const likes = await getLocalPatternLikes();
  return {
    progress: {},
    completions: {},
    pendingRewards: {},
    likes,
  };
}

export async function fetchPromotionPreview(dto: PromotionPreviewRequest): Promise<PromotionPreviewResponse> {
  const res = await apiFetch('/v1/promotion/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!res.ok) {
    throw new Error('Failed to fetch promotion preview: ' + res.status);
  }

  return (await res.json()) as PromotionPreviewResponse;
}

export async function lockPromotion(previewData: any, signature: string): Promise<PromotionLockResponse> {
  const res = await apiFetch('/v1/promotion/lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewData, signature }),
  });

  if (!res.ok) {
    throw new Error('Failed to lock promotion: ' + res.status);
  }

  return (await res.json()) as PromotionLockResponse;
}

export async function stagePromotionPackage(dto: PromotionPackageRequest): Promise<{ status: string; expiry: string }> {
  const res = await apiFetch('/v1/promotion/stage-package', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dto),
  });

  if (!res.ok) {
    throw new Error('Failed to stage promotion package: ' + res.status);
  }

  return (await res.json()) as { status: string; expiry: string };
}

export async function cancelPromotion(guestId: string): Promise<{ status: string }> {
  const res = await apiFetch('/v1/promotion/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId }),
  });

  if (!res.ok) {
    throw new Error('Failed to cancel promotion: ' + res.status);
  }

  return (await res.json()) as { status: string };
}

export async function commitPromotion(previewData: any, signature: string): Promise<{ status: string }> {
  const res = await apiFetch('/v1/promotion/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewData, signature }),
  });

  if (!res.ok) {
    throw new Error('Failed to commit promotion: ' + res.status);
  }

  return (await res.json()) as { status: string };
}

export async function drainSession(guestId: string, patternId: string, guestSessionId: string): Promise<any> {
  const res = await apiFetch('/v1/promotion/drain/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId, patternId, guestSessionId }),
  });

  if (!res.ok) {
    throw new Error('Failed to drain session: ' + res.status);
  }

  return await res.json();
}

export async function drainLike(guestId: string, patternId: string): Promise<any> {
  const res = await apiFetch('/v1/promotion/drain/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId, patternId }),
  });

  if (!res.ok) {
    throw new Error('Failed to drain like: ' + res.status);
  }

  const data = await res.json();
  await setLocalPatternLike(patternId, false);
  return data;
}
