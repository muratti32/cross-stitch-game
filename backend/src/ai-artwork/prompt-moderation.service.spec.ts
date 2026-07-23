import { AppConfigService } from '../config';
import { PromptModerationService } from './prompt-moderation.service';

describe('PromptModerationService', () => {
  const originalFetch = global.fetch;
  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiApiKey;
    }
  });

  it('skips the OpenAI request when moderation is disabled', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    global.fetch = fetchMock;
    const config = { openAiModerationEnabled: false } as AppConfigService;

    await expect(
      new PromptModerationService(config).isFlagged('a fox'),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses omni-moderation-latest when moderation is enabled', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [{ flagged: true }] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      );
    global.fetch = fetchMock;
    const config = { openAiModerationEnabled: true } as AppConfigService;

    await expect(
      new PromptModerationService(config).isFlagged('a fox'),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/moderations',
      expect.objectContaining({
        body: JSON.stringify({
          input: 'a fox',
          model: 'omni-moderation-latest',
        }),
        method: 'POST',
      }),
    );
  });
});
