import { captureGameplayEvent } from '../analytics/gameplayEvents';
import type { AiArtwork } from './api';

/** Records a terminal AI result once, without retaining its prompt or artwork. */
export function captureAiArtworkTerminalOutcome(artwork: AiArtwork): void {
  if (artwork.status === 'delivered') {
    void captureGameplayEvent(
      'ai_generation_completed',
      { aspect: artwork.aspect },
      `ai-artwork:${artwork.id}:completed`,
    );
    return;
  }

  if (artwork.status === 'safety_rejected') {
    void captureGameplayEvent(
      'ai_generation_failed',
      { failure_stage: 'provider_safety' },
      `ai-artwork:${artwork.id}:failed`,
    );
    return;
  }

  if (artwork.status === 'failed') {
    void captureGameplayEvent(
      'ai_generation_failed',
      { failure_stage: 'delivery' },
      `ai-artwork:${artwork.id}:failed`,
    );
  }
}

export function isPromptSafetyRejection(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Prompt Safety Rejection');
}
