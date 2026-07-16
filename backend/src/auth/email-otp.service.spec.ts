import { DataSource, EntityManager } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { AccountIdentityService } from './account-identity.service';
import { EmailOtpRateLimiterService } from './email-otp-rate-limiter.service';
import { EmailOtpService } from './email-otp.service';
import { EmailVerificationCodeEntity } from './entities';
import { EmailOutboxEntity } from './email-outbox.entity';

describe('EmailOtpService', () => {
  const config = {
    emailOtpMaxAttempts: 5,
    emailOtpTtlSeconds: 600,
    otpSigningSecret: 'unit-test-only-otp-signing-secret-at-least-32-chars',
  } as unknown as AppConfigService;

  it('uses a keyed verifier and timing-safe match comparison', () => {
    const service = new EmailOtpService(
      config,
      {} as DataSource,
      {} as EmailOtpRateLimiterService,
      {} as AccountIdentityService,
    );
    const verifier = service.hashCode('000123');

    expect(verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier).not.toContain('000123');
    expect(service.matchesVerifier('000123', verifier)).toBe(true);
    expect(service.matchesVerifier('000124', verifier)).toBe(false);
  });

  it('rejects a code already at its attempt cap without consuming it', async () => {
    const code = {
      attempts: 5,
      codeVerifier: '0'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      id: 'a9d1186b-04cd-4c03-a749-5a45fd7584d7',
      maxAttempts: 5,
    } as EmailVerificationCodeEntity;
    const manager = verificationManager(code);
    const dataSource = {
      transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
        work(manager),
    } as unknown as DataSource;
    const service = new EmailOtpService(
      config,
      dataSource,
      {} as EmailOtpRateLimiterService,
      {} as AccountIdentityService,
    );

    await expect(service.verify('person@example.test', '000123')).resolves.toBeNull();
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('supersedes the prior active code before persisting the new outbox delivery', async () => {
    const updateExecute = jest.fn<Promise<void>, []>().mockResolvedValue();
    const codeSave = jest
      .fn<Promise<EmailVerificationCodeEntity>, [EmailVerificationCodeEntity]>()
      .mockResolvedValue({ id: '311771a7-233d-466f-b133-cdc7eb840b61' } as EmailVerificationCodeEntity);
    const outboxSave = jest
      .fn<Promise<EmailOutboxEntity>, [EmailOutboxEntity]>()
      .mockResolvedValue({} as EmailOutboxEntity);
    const updateBuilder: UpdateBuilder = {
      andWhere: () => updateBuilder,
      execute: updateExecute,
      set: () => updateBuilder,
      update: () => updateBuilder,
      where: () => updateBuilder,
    };
    const codeRepository = {
      create: (value: EmailVerificationCodeEntity): EmailVerificationCodeEntity => value,
      createQueryBuilder: () => updateBuilder,
      save: codeSave,
    };
    const outboxRepository = {
      create: (value: EmailOutboxEntity): EmailOutboxEntity => value,
      save: outboxSave,
    };
    const manager = {
      getRepository: (entity: unknown): unknown =>
        entity === EmailVerificationCodeEntity
          ? codeRepository
          : outboxRepository,
      query: jest.fn<Promise<unknown[]>, [string, unknown[]]>().mockResolvedValue([]),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: async <T>(work: (inner: EntityManager) => Promise<T>) =>
        work(manager),
    } as unknown as DataSource;
    const rateLimiter = {
      consumeEmail: jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true),
      consumeIp: jest.fn<Promise<boolean>, [string]>().mockResolvedValue(true),
    } as unknown as EmailOtpRateLimiterService;
    const service = new EmailOtpService(
      config,
      dataSource,
      rateLimiter,
      {} as AccountIdentityService,
    );

    await service.request('PERSON@example.test', '127.0.0.1');

    expect(updateExecute).toHaveBeenCalledTimes(1);
    expect(outboxSave).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: '311771a7-233d-466f-b133-cdc7eb840b61',
        toEmail: 'person@example.test',
      }),
    );
  });
});

function verificationManager(code: EmailVerificationCodeEntity): EntityManager {
  const getOne = jest.fn<Promise<EmailVerificationCodeEntity>, []>().mockResolvedValue(code);
  const builder: VerificationBuilder = {
    andWhere: () => builder,
    getOne,
    orderBy: () => builder,
    setLock: () => builder,
    where: () => builder,
  };
  return {
    getRepository: () => ({
      createQueryBuilder: () => builder,
    }),
    query: jest.fn<Promise<unknown[]>, [string, unknown[]]>().mockResolvedValue([]),
  } as unknown as EntityManager;
}

interface UpdateBuilder {
  andWhere(): UpdateBuilder;
  execute(): Promise<void>;
  set(): UpdateBuilder;
  update(): UpdateBuilder;
  where(): UpdateBuilder;
}

interface VerificationBuilder {
  andWhere(): VerificationBuilder;
  getOne(): Promise<EmailVerificationCodeEntity>;
  orderBy(): VerificationBuilder;
  setLock(): VerificationBuilder;
  where(): VerificationBuilder;
}
