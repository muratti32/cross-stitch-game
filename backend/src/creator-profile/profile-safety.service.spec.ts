import { AppConfigService } from '../config/app-config.service';
import { ProfileSafetyService } from './profile-safety.service';
import { ProfileTextPolicyService } from './profile-text-policy.service';

describe('ProfileSafetyService', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  });

  it('uses the documented multimodal moderation input for avatars', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [{ flagged: false }] }), {
          status: 200,
        }),
      );
    global.fetch = fetchMock;
    const service = new ProfileSafetyService(
      { openAiModerationEnabled: true } as AppConfigService,
      new ProfileTextPolicyService(),
    );

    await expect(
      service.checkAvatar({ buffer: png, mimetype: 'image/png', size: png.length }),
    ).resolves.toMatchObject({ contentType: 'image/png', extension: 'png' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/moderations',
      expect.objectContaining({
        body: JSON.stringify({
          input: [
            {
              image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
              type: 'image_url',
            },
          ],
          model: 'omni-moderation-latest',
        }),
        method: 'POST',
      }),
    );
  });

  it('fails closed and returns a user-facing reason for a flagged avatar', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    global.fetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [{ flagged: true }] }), {
          status: 200,
        }),
      );
    const service = new ProfileSafetyService(
      { openAiModerationEnabled: true } as AppConfigService,
      new ProfileTextPolicyService(),
    );

    await expect(
      service.checkAvatar({ buffer: png, mimetype: 'image/png', size: png.length }),
    ).rejects.toMatchObject({
      response: {
        code: 'PROFILE_SAFETY_REJECTED',
        reason: 'Avatar was rejected by the safety check',
      },
    });
  });

  it('fails closed when the moderation response is malformed', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    global.fetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('not-json', { status: 200 }));
    const service = new ProfileSafetyService(
      { openAiModerationEnabled: true } as AppConfigService,
      new ProfileTextPolicyService(),
    );

    await expect(
      service.checkAvatar({ buffer: png, mimetype: 'image/png', size: png.length }),
    ).rejects.toMatchObject({
      response: { message: 'Profile Safety Check is unavailable' },
      status: 503,
    });
  });

  it('allows hermetic development when moderation is explicitly disabled', async () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    global.fetch = fetchMock;
    const service = new ProfileSafetyService(
      { openAiModerationEnabled: false } as AppConfigService,
      new ProfileTextPolicyService(),
    );

    await expect(
      service.checkAvatar({ buffer: png, mimetype: 'image/png', size: png.length }),
    ).resolves.toMatchObject({ contentType: 'image/png' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
