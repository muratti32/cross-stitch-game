import { apiFetch } from '@/api/apiFetch';
import { Config } from '@/config';
import type { ConversionProfile, PendingConversion } from '@/conversion';

export type ArtworkAspect = 'square' | 'portrait_4_3' | 'landscape_4_3';
export interface AiArtwork { id: string; aspect: ArtworkAspect; status: string; failureReason: string | null; supportReference: string | null; createdAt: string; imageUrl: string | null; }
export class AiCreditShortfallError extends Error {
  constructor() {
    super('No available AI Credit');
    this.name = 'AiCreditShortfallError';
  }
}

async function message(response: Response) { try { const body = await response.json() as { message?: unknown }; return typeof body.message === 'string' ? body.message : null; } catch { return null; } }
export async function generateAiArtwork(prompt: string, aspect: ArtworkAspect) { const r = await apiFetch('/v1/ai-artworks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, aspect }) }); if (!r.ok) { const detail = await message(r); if (r.status === 409 && detail === 'No available AI Credit') throw new AiCreditShortfallError(); throw new Error(detail ?? `Generation request failed (${r.status})`); } return r.json() as Promise<{ id: string }>; }
export async function listAiArtworks(): Promise<AiArtwork[]> { const r = await apiFetch('/v1/ai-artworks'); if (!r.ok) throw new Error(`Could not load AI Artwork Library (${r.status})`); const rows = await r.json() as AiArtwork[]; return rows.map((x) => ({ ...x, imageUrl: x.imageUrl && !x.imageUrl.startsWith('http') ? `${Config.apiBaseUrl}${x.imageUrl}` : x.imageUrl })); }
export async function deleteAiArtwork(id: string) { const r = await apiFetch(`/v1/ai-artworks/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(`Could not delete artwork (${r.status})`); }
export async function approveAiArtwork(id: string, title: string, profile: ConversionProfile = 'easy') { const r = await apiFetch(`/v1/ai-artworks/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, profile }) }); if (!r.ok) throw new Error((await message(r)) ?? `Artwork approval failed (${r.status})`); return r.json() as Promise<PendingConversion>; }
