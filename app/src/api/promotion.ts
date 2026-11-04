import { apiFetch } from './apiFetch';
import {
  invalidPromotionResponse,
  isPromotionJsonRecord,
  parseCommerceStatus,
  parsePromotionCommit,
  parsePromotionLock,
  parsePromotionPreview,
  parsePromotionStage,
  PromotionApiError,
  type CommercePromotionStatus,
  type PromotionCommitResponse,
  type PromotionLockResponse,
  type PromotionPackageRequest,
  type PromotionPreviewRequest,
  type PromotionPreviewResponse,
  type PromotionStageResponse,
} from './promotionContract';

export * from './promotionContract';

async function failureFrom(res: Response): Promise<PromotionApiError> {
  let code: string | null = null;
  let message = `Promotion request failed with status ${res.status}`;
  try {
    const body: unknown = await res.json();
    if (isPromotionJsonRecord(body)) {
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.message === 'string') message = body.message;
    }
  } catch {
    // An unreadable error body leaves the status as the only signal.
  }
  return new PromotionApiError(res.status, code, message);
}

type PromotionRequestInit = { method: 'GET' } | { method: 'POST'; body: unknown };

async function send(path: string, init: PromotionRequestInit): Promise<Response> {
  const res = await apiFetch(
    path,
    init.method === 'GET'
      ? { method: 'GET' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(init.body),
        },
  );
  if (!res.ok) throw await failureFrom(res);
  return res;
}

async function requestPromotion<T>(
  path: string,
  init: PromotionRequestInit,
  parse: (body: unknown, status: number) => T,
): Promise<T> {
  const res = await send(path, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw invalidPromotionResponse(res.status, 'body is not JSON');
  }
  return parse(body, res.status);
}

export function startCommercePromotion(guestId: string, guestCredential: string): Promise<CommercePromotionStatus> {
  return requestPromotion(
    '/v1/promotion/commerce-handoff',
    { method: 'POST', body: { guestId, guestCredential } },
    parseCommerceStatus,
  );
}

export function fetchCommercePromotionStatus(handoffId: string): Promise<CommercePromotionStatus> {
  return requestPromotion(
    `/v1/promotion/commerce-handoff/${encodeURIComponent(handoffId)}`,
    { method: 'GET' },
    parseCommerceStatus,
  );
}

export function fetchPromotionPreview(dto: PromotionPreviewRequest): Promise<PromotionPreviewResponse> {
  return requestPromotion('/v1/promotion/preview', { method: 'POST', body: dto }, parsePromotionPreview);
}

export function lockPromotion(
  previewData: PromotionPreviewResponse,
  signature: string,
): Promise<PromotionLockResponse> {
  return requestPromotion('/v1/promotion/lock', { method: 'POST', body: { previewData, signature } }, parsePromotionLock);
}

export function stagePromotionPackage(dto: PromotionPackageRequest): Promise<PromotionStageResponse> {
  return requestPromotion('/v1/promotion/stage-package', { method: 'POST', body: dto }, parsePromotionStage);
}

export async function cancelPromotion(guestId: string): Promise<void> {
  await send('/v1/promotion/cancel', { method: 'POST', body: { guestId } });
}

export function commitPromotion(
  previewData: PromotionPreviewResponse,
  signature: string,
): Promise<PromotionCommitResponse> {
  return requestPromotion('/v1/promotion/commit', { method: 'POST', body: { previewData, signature } }, parsePromotionCommit);
}

/** Idempotent. Resolves once the backend acknowledged the Guest session's transfer. */
export async function drainSession(guestId: string, patternId: string, guestSessionId: string): Promise<void> {
  await send('/v1/promotion/drain/session', { method: 'POST', body: { guestId, patternId, guestSessionId } });
}

/** Idempotent. Resolves once the backend acknowledged the Guest's Like transfer. */
export async function drainLike(guestId: string, patternId: string): Promise<void> {
  await send('/v1/promotion/drain/like', { method: 'POST', body: { guestId, patternId } });
}
