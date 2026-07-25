import type { AppConfigService } from '../config/app-config.service';
import {
  FalArtworkProviderService,
  FalArtworkSubmissionRejectedError,
} from './fal-artwork-provider.service';

describe('FalArtworkProviderService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('submits to the turbo endpoint with the requested aspect and webhook', async () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response(JSON.stringify({ request_id: 'request-1' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    );
    global.fetch = fetchMock;

    const requestId = await provider().submit(
      'a fox',
      'portrait_4_3',
      'https://example.test/webhook',
    );

    expect(requestId).toBe('request-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://queue.fal.run/fal-ai/flux-2/turbo',
      expect.objectContaining({
        body: JSON.stringify({
          prompt: 'a fox',
          image_size: 'portrait_4_3',
          num_images: 1,
          enable_safety_checker: true,
          webhook_url: 'https://example.test/webhook',
        }),
        method: 'POST',
      }),
    );
  });

  it('polls and reads results from the canonical flux-2 queue path', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'COMPLETED' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            has_nsfw_concepts: [false],
            images: [{ url: 'https://example.test/image.png' }],
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200,
          },
        ),
      );
    global.fetch = fetchMock;

    await expect(
      provider().result('request-1'),
    ).resolves.toEqual({
      unsafe: false,
      url: 'https://example.test/image.png',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://queue.fal.run/fal-ai/flux-2/requests/request-1/status',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://queue.fal.run/fal-ai/flux-2/requests/request-1',
      expect.any(Object),
    );
  });

  it('marks a definitive client-side submit rejection separately', async () => {
    global.fetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(null, { status: 400 }));

    await expect(
      provider().submit(
        'a fox',
        'square',
        'https://example.test/webhook',
      ),
    ).rejects.toBeInstanceOf(FalArtworkSubmissionRejectedError);
  });
});

function provider(): FalArtworkProviderService {
  return new FalArtworkProviderService({
    falKey: 'test-fal-key',
  } as unknown as AppConfigService);
}
