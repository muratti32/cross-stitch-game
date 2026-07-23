import { Injectable } from '@nestjs/common';
import type { ArtworkAspect } from './entities';

const MODEL = 'fal-ai/flux-2/turbo';
// fal submits the turbo route through the flux-2 queue and returns status/result
// URLs under this canonical queue path.
const QUEUE_MODEL = 'fal-ai/flux-2';
const imageSize: Record<ArtworkAspect, string> = { square: 'square', portrait_4_3: 'portrait_4_3', landscape_4_3: 'landscape_4_3' };

export class FalArtworkSubmissionRejectedError extends Error {}

@Injectable()
export class FalArtworkProviderService {
  private key(): string { const key = process.env.FAL_KEY; if (!key) throw new Error('fal.ai is not configured'); return key; }
  async submit(prompt: string, aspect: ArtworkAspect, webhookUrl: string): Promise<string> {
    const response = await fetch(`https://queue.fal.run/${MODEL}`, { method: 'POST', headers: { Authorization: `Key ${this.key()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, image_size: imageSize[aspect], num_images: 1, enable_safety_checker: true, webhook_url: webhookUrl }) });
    if (!response.ok) {
      const error = new Error(`fal.ai submit failed (${response.status})`);
      if (response.status >= 400 && response.status < 500) {
        throw new FalArtworkSubmissionRejectedError(error.message);
      }
      throw error;
    }
    const body = await response.json() as { request_id?: unknown };
    if (typeof body.request_id !== 'string') throw new Error('fal.ai returned no request id');
    return body.request_id;
  }
  async result(requestId: string): Promise<{ unsafe: boolean; url: string; failed?: false } | { failed: true; unsafe?: false; url?: '' } | null> {
    const headers = { Authorization: `Key ${this.key()}` };
    const statusResponse = await fetch(`https://queue.fal.run/${QUEUE_MODEL}/requests/${encodeURIComponent(requestId)}/status`, { headers });
    if (statusResponse.status === 404 || statusResponse.status === 202) return null;
    if (!statusResponse.ok) throw new Error(`fal.ai status failed (${statusResponse.status})`);
    const status = await statusResponse.json() as { status?: unknown };
    if (status.status === 'FAILED' || status.status === 'CANCELLED') return { failed: true };
    if (status.status !== 'COMPLETED') return null;
    const response = await fetch(`https://queue.fal.run/${QUEUE_MODEL}/requests/${encodeURIComponent(requestId)}`, { headers });
    if (!response.ok) throw new Error(`fal.ai result failed (${response.status})`);
    const data = await response.json() as { images?: Array<{ url?: unknown }>; has_nsfw_concepts?: unknown };
    if (Array.isArray(data.has_nsfw_concepts) && data.has_nsfw_concepts.some(Boolean)) return { unsafe: true, url: '' };
    const url = data.images?.[0]?.url;
    if (typeof url !== 'string') throw new Error('fal.ai returned no image');
    return { unsafe: false, url };
  }
}
