import { apiFetch } from '@/api/apiFetch';
import { Config } from '@/config';
import type { ConversionProfile, PendingConversion } from '@/conversion';

export type ArtworkAspect = 'square' | 'portrait_4_3' | 'landscape_4_3';
export interface AiArtwork { id: string; prompt: string; aspect: ArtworkAspect; status: string; failureReason: string | null; supportReference: string | null; createdAt: string; imageUrl: string | null; }
export class AiCreditShortfallError extends Error {
  constructor() {
    super('No available AI Credit');
    this.name = 'AiCreditShortfallError';
  }
}

// #168: shaped like EconomyApiError/MembershipApiError (ad287a4) so a caught
// AI Artwork failure routes through localizeServerError instead of the
// server's raw English message. The backend does not send a `reason` code
// for this module's endpoints today, so `reason` is always null here -
// isServerApiError still duck-types on it and localizeServerError still
// resolves a null reason to the generic localized failure plus a Support
// Reference, which is strictly better than rendering raw server text.
export class AiArtworkApiError extends Error {
  constructor(readonly status: number, message: string, readonly reason: string | null) {
    super(message);
    this.name = 'AiArtworkApiError';
  }
}

async function readError(response: Response): Promise<{ message: string | null; reason: string | null }> {
  try {
    const body = await response.json() as { message?: unknown; reason?: unknown };
    return {
      message: typeof body.message === 'string' ? body.message : null,
      reason: typeof body.reason === 'string' ? body.reason : null,
    };
  } catch {
    return { message: null, reason: null };
  }
}

export async function generateAiArtwork(prompt: string, aspect: ArtworkAspect) {
  const r = await apiFetch('/v1/ai-artworks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, aspect }) });
  if (!r.ok) {
    const detail = await readError(r);
    if (r.status === 409 && detail.message === 'No available AI Credit') throw new AiCreditShortfallError();
    throw new AiArtworkApiError(r.status, detail.message ?? `Generation request failed (${r.status})`, detail.reason);
  }
  return r.json() as Promise<{ id: string }>;
}
export async function listAiArtworks(): Promise<AiArtwork[]> {
  const r = await apiFetch('/v1/ai-artworks');
  if (!r.ok) {
    const detail = await readError(r);
    throw new AiArtworkApiError(r.status, detail.message ?? `Could not load AI Artwork Library (${r.status})`, detail.reason);
  }
  const rows = await r.json() as AiArtwork[];
  return rows.map((x) => ({ ...x, imageUrl: x.imageUrl && !x.imageUrl.startsWith('http') ? `${Config.apiBaseUrl}${x.imageUrl}` : x.imageUrl }));
}
export async function deleteAiArtwork(id: string) {
  const r = await apiFetch(`/v1/ai-artworks/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const detail = await readError(r);
    throw new AiArtworkApiError(r.status, detail.message ?? `Could not delete artwork (${r.status})`, detail.reason);
  }
}
export async function approveAiArtwork(id: string, title: string, profile: ConversionProfile = 'easy') {
  const r = await apiFetch(`/v1/ai-artworks/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, profile }) });
  if (!r.ok) {
    const detail = await readError(r);
    throw new AiArtworkApiError(r.status, detail.message ?? `Artwork approval failed (${r.status})`, detail.reason);
  }
  return r.json() as Promise<PendingConversion>;
}
