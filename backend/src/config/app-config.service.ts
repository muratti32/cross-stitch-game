import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from './environment';

@Injectable()
export class AppConfigService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  get databaseUrl(): string {
    return this.configService.get('DATABASE_URL', { infer: true });
  }

  get jwtAccessTtlSeconds(): number {
    return this.configService.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  get jwtSecret(): string {
    const secret = this.configService.get('JWT_SECRET', { infer: true });
    if (secret === undefined) {
      throw new Error('JWT_SECRET is required for the API deployable');
    }
    return secret;
  }

  get port(): number {
    return this.configService.get('PORT', { infer: true });
  }

  get redisUrl(): string {
    return this.configService.get('REDIS_URL', { infer: true });
  }

  get refreshTokenTtlSeconds(): number {
    return this.configService.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true });
  }

  get storageLocalDir(): string {
    return this.configService.get('STORAGE_LOCAL_DIR', { infer: true });
  }

  get r2AccountId(): string | undefined {
    return this.configService.get('R2_ACCOUNT_ID', { infer: true });
  }

  get r2AccessKeyId(): string | undefined {
    return this.configService.get('R2_ACCESS_KEY_ID', { infer: true });
  }

  get r2SecretAccessKey(): string | undefined {
    return this.configService.get('R2_SECRET_ACCESS_KEY', { infer: true });
  }

  get r2BucketName(): string | undefined {
    return this.configService.get('R2_BUCKET_NAME', { infer: true });
  }

  get r2PublicHostname(): string | undefined {
    return this.configService.get('R2_PUBLIC_HOSTNAME', { infer: true });
  }

  get grantTtlSeconds(): number {
    return this.configService.get('GRANT_TTL_SECONDS', { infer: true });
  }

  get grantSigningSecret(): string {
    const secret = this.configService.get('GRANT_SIGNING_SECRET', { infer: true });
    if (secret === undefined) {
      throw new Error('GRANT_SIGNING_SECRET is required for the API deployable');
    }
    return secret;
  }

  get resendApiKey(): string | undefined {
    return this.configService.get('RESEND_API_KEY', { infer: true });
  }

  get otpSigningSecret(): string {
    const secret = this.configService.get('OTP_SIGNING_SECRET', {
      infer: true,
    });
    if (secret === undefined) {
      throw new Error('OTP_SIGNING_SECRET is required for email authentication');
    }
    return secret;
  }

  get emailFromAddress(): string {
    return this.configService.get('EMAIL_FROM_ADDRESS', { infer: true });
  }

  get emailOtpTtlSeconds(): number {
    return this.configService.get('EMAIL_OTP_TTL_SECONDS', { infer: true });
  }

  get emailOtpMaxAttempts(): number {
    return this.configService.get('EMAIL_OTP_MAX_ATTEMPTS', { infer: true });
  }

  get emailOtpRateLimitPerEmail(): number {
    return this.configService.get('EMAIL_OTP_RATE_LIMIT_PER_EMAIL', {
      infer: true,
    });
  }

  get emailOtpRateLimitPerIp(): number {
    return this.configService.get('EMAIL_OTP_RATE_LIMIT_PER_IP', {
      infer: true,
    });
  }

  get firebaseProjectId(): string | undefined {
    return this.configService.get('FIREBASE_PROJECT_ID', { infer: true });
  }

  get firebaseServiceAccountBase64(): string | undefined {
    return this.configService.get('FIREBASE_SERVICE_ACCOUNT_BASE64', {
      infer: true,
    });
  }

  get conversionEngineUrl(): string {
    return this.configService.get('CONVERSION_ENGINE_URL', { infer: true });
  }

  get conversionWorkerConcurrency(): number {
    return this.configService.get('CONVERSION_WORKER_CONCURRENCY', {
      infer: true,
    });
  }

  get adminJwtSecret(): string {
    const secret = this.configService.get('ADMIN_JWT_SECRET', { infer: true });
    if (secret === undefined) {
      throw new Error('ADMIN_JWT_SECRET is required for the Operator Console API');
    }
    return secret;
  }

  get adminJwtAccessTtlSeconds(): number {
    return this.configService.get('ADMIN_JWT_ACCESS_TTL_SECONDS', {
      infer: true,
    });
  }

  get adminMfaEnabled(): boolean {
    return this.configService.get('ADMIN_MFA_ENABLED', { infer: true });
  }

  get adminRefreshTokenTtlSeconds(): number {
    return this.configService.get('ADMIN_REFRESH_TOKEN_TTL_SECONDS', {
      infer: true,
    });
  }

  get adminTotpEncryptionKey(): string {
    const key = this.configService.get('ADMIN_TOTP_ENC_KEY', { infer: true });
    if (key === undefined) {
      throw new Error('ADMIN_TOTP_ENC_KEY is required for the Operator Console API');
    }
    return key;
  }

  get adminTotpIssuer(): string {
    return this.configService.get('ADMIN_TOTP_ISSUER', { infer: true });
  }

  get enableAdmobSsv(): boolean {
    return this.configService.get('ENABLE_ADMOB_SSV', { infer: true });
  }

  get iosGuestCommerceEnabled(): boolean {
    return this.configService.get('ENABLE_IOS_GUEST_COMMERCE', { infer: true });
  }

  get admobSsvKeysUrl(): string {
    return this.configService.get('ADMOB_SSV_KEYS_URL', { infer: true });
  }

  get admobSsvAllowedAdUnits(): readonly string[] {
    return this.configService.get('ADMOB_SSV_ALLOWED_AD_UNITS', {
      infer: true,
    });
  }

  get revenueCatWebhookAuthToken(): string | undefined {
    return this.configService.get('REVENUECAT_WEBHOOK_AUTH_TOKEN', {
      infer: true,
    });
  }

  get adAttemptTtlSeconds(): number {
    return this.configService.get('AD_ATTEMPT_TTL_SECONDS', { infer: true });
  }

  get falWebhookSecret(): string | undefined {
    return this.configService.get('FAL_WEBHOOK_SECRET', { infer: true });
  }

  get falKey(): string | undefined {
    return this.configService.get('FAL_KEY', { infer: true });
  }

  get falWebhookBaseUrl(): string | undefined {
    return this.configService.get('FAL_WEBHOOK_BASE_URL', { infer: true });
  }

  get webhookArchiveRetentionSeconds(): number {
    return this.configService.get('WEBHOOK_ARCHIVE_RETENTION_SECONDS', {
      infer: true,
    });
  }

  get webhookArchivePurgeIntervalSeconds(): number {
    return this.configService.get('WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS', {
      infer: true,
    });
  }

  get gameplayEventRetentionMonths(): number {
    return this.configService.get('GAMEPLAY_EVENT_RETENTION_MONTHS', {
      infer: true,
    });
  }

  get gameplayEventPartitionMaintenanceIntervalSeconds(): number {
    return this.configService.get(
      'GAMEPLAY_EVENT_PARTITION_MAINTENANCE_INTERVAL_SECONDS',
      { infer: true },
    );
  }

  get reconciliationIntervalSeconds(): number {
    return this.configService.get('RECONCILIATION_INTERVAL_SECONDS', {
      infer: true,
    });
  }

  get storageObjectVerificationEnabled(): boolean {
    return this.configService.get('STORAGE_OBJECT_VERIFICATION_ENABLED', {
      infer: true,
    });
  }

  get storageReconcilerIntervalSeconds(): number {
    return this.configService.get('STORAGE_RECONCILER_INTERVAL_SECONDS', {
      infer: true,
    });
  }

  get storageReconcilerBatchSize(): number {
    return this.configService.get('STORAGE_RECONCILER_BATCH_SIZE', {
      infer: true,
    });
  }

  get storageBucketListingIntervalSeconds(): number {
    return this.configService.get('STORAGE_BUCKET_LISTING_INTERVAL_SECONDS', {
      infer: true,
    });
  }

  get storageObjectVerificationIntervalSeconds(): number {
    return this.configService.get('STORAGE_OBJECT_VERIFICATION_INTERVAL_SECONDS', {
      infer: true,
    });
  }

  get aiCreditReservationStalenessSeconds(): number {
    return this.configService.get('AI_CREDIT_RESERVATION_STALENESS_SECONDS', {
      infer: true,
    });
  }

  get operationalAlertsEvaluationIntervalSeconds(): number {
    return this.configService.get('OPERATIONAL_ALERTS_EVALUATION_INTERVAL_SECONDS', {
      infer: true,
    });
  }

  get operationalAlertsCooldownSeconds(): number {
    return this.configService.get('OPERATIONAL_ALERTS_COOLDOWN_SECONDS', {
      infer: true,
    });
  }

  get operationalAlertsQueueDepthThreshold(): number {
    return this.configService.get('OPERATIONAL_ALERTS_QUEUE_DEPTH_THRESHOLD', {
      infer: true,
    });
  }

  get operationalAlertsWebhookFailureThreshold(): number {
    return this.configService.get('OPERATIONAL_ALERTS_WEBHOOK_FAILURE_THRESHOLD', {
      infer: true,
    });
  }

  get operationalAlertsWebhookFailureWindowSeconds(): number {
    return this.configService.get(
      'OPERATIONAL_ALERTS_WEBHOOK_FAILURE_WINDOW_SECONDS',
      { infer: true },
    );
  }

  get operationalAlertsStuckJobThreshold(): number {
    return this.configService.get('OPERATIONAL_ALERTS_STUCK_JOB_THRESHOLD', {
      infer: true,
    });
  }

  get operationalAlertsStuckJobStalenessSeconds(): number {
    return this.configService.get(
      'OPERATIONAL_ALERTS_STUCK_JOB_STALENESS_SECONDS',
      { infer: true },
    );
  }

  get operationalAlertsPromotionNeedsAttentionThreshold(): number {
    return this.configService.get(
      'OPERATIONAL_ALERTS_PROMOTION_NEEDS_ATTENTION_THRESHOLD',
      { infer: true },
    );
  }

  get openAiModerationEnabled(): boolean {
    return this.configService.get('OPENAI_MODERATION_ENABLED', { infer: true });
  }

  get sentryDsn(): string | undefined {
    return this.configService.get('SENTRY_DSN', { infer: true });
  }

  get sentryEnvironment(): string {
    return this.configService.get('SENTRY_ENVIRONMENT', { infer: true });
  }

  get sentryRelease(): string | undefined {
    return this.configService.get('SENTRY_RELEASE', { infer: true });
  }

  get sentryTracesSampleRate(): number {
    return this.configService.get('SENTRY_TRACES_SAMPLE_RATE', {
      infer: true,
    });
  }
}
