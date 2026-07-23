import { UnauthorizedException } from '@nestjs/common';

import type { AppConfigService } from '../config/app-config.service';
import { RevenueCatWebhookVerifierService } from './revenuecat-webhook-verifier.service';

const VALID_TOKEN = 'super_secret_webhook_token_value_at_least_32_chars';

function configStub(token: string | undefined): AppConfigService {
  return {
    revenueCatWebhookAuthToken: token,
  } as unknown as AppConfigService;
}

describe('RevenueCatWebhookVerifierService', () => {
  it('accepts a valid token', () => {
    const service = new RevenueCatWebhookVerifierService(configStub(VALID_TOKEN));
    expect(() => service.verify(VALID_TOKEN)).not.toThrow();
  });

  it('accepts a Bearer-prefixed token', () => {
    const service = new RevenueCatWebhookVerifierService(configStub(VALID_TOKEN));
    expect(() => service.verify(`Bearer ${VALID_TOKEN}`)).not.toThrow();
  });

  it('rejects a missing header', () => {
    const service = new RevenueCatWebhookVerifierService(configStub(VALID_TOKEN));
    expect(() => service.verify(undefined)).toThrow(UnauthorizedException);
    expect(() => service.verify('')).toThrow(UnauthorizedException);
  });

  it('rejects a wrong token', () => {
    const service = new RevenueCatWebhookVerifierService(configStub(VALID_TOKEN));
    expect(() => service.verify('wrong_token')).toThrow(UnauthorizedException);
  });

  it('always rejects when secret is unconfigured', () => {
    const service = new RevenueCatWebhookVerifierService(configStub(undefined));
    expect(() => service.verify(VALID_TOKEN)).toThrow(UnauthorizedException);
    expect(() => service.verify(undefined)).toThrow(UnauthorizedException);
  });
});
