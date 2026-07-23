import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class PromptModerationService {
  async isFlagged(prompt: string): Promise<boolean> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('Prompt Safety Check is unavailable');
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: prompt, model: 'omni-moderation-latest' }),
      });
    } catch { throw new ServiceUnavailableException('Prompt Safety Check is unavailable'); }
    if (!response.ok) throw new ServiceUnavailableException('Prompt Safety Check is unavailable');
    const body = await response.json() as { results?: Array<{ flagged?: unknown }> };
    const flagged = body.results?.[0]?.flagged;
    if (typeof flagged !== 'boolean') throw new ServiceUnavailableException('Prompt Safety Check is unavailable');
    return flagged;
  }
}
