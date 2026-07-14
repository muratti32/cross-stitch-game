import { AppConfigService } from '../config/app-config.service';
import { EmailOtpRateLimiterService } from './email-otp-rate-limiter.service';

const mockRedis = {
  expire: jest.fn<Promise<number>, [string, number]>(),
  incr: jest.fn<Promise<number>, [string]>(),
  quit: jest.fn<Promise<'OK'>, []>(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => mockRedis),
}));

describe('EmailOtpRateLimiterService', () => {
  it('uses a Redis fixed-window counter and applies the configured limit', async () => {
    const config = {
      emailOtpRateLimitPerEmail: 2,
      emailOtpRateLimitPerIp: 3,
      emailOtpTtlSeconds: 600,
      redisUrl: 'redis://localhost:6379',
    } as unknown as AppConfigService;
    const service = new EmailOtpRateLimiterService(config);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.incr
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);

    await expect(service.consumeEmail('person@example.test')).resolves.toBe(true);
    await expect(service.consumeEmail('person@example.test')).resolves.toBe(true);
    await expect(service.consumeEmail('person@example.test')).resolves.toBe(false);

    expect(mockRedis.expire).toHaveBeenCalledTimes(1);
    expect(mockRedis.incr.mock.calls[0]?.[0]).toMatch(
      /^email-otp:email:\d+:person@example\.test$/,
    );
    await service.onModuleDestroy();
  });
});
