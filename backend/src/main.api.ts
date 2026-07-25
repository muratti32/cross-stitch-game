import './observability/sentry';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { configureApi } from './api/configure-api';
import { ApiAppModule } from './app.api.module';
import { AppConfigService } from './config/app-config.service';
import { captureBootstrapFailure } from './observability';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ApiAppModule);

  try {
    configureApi(app);
    app.enableShutdownHooks();

    const config = app.get(AppConfigService);
    await app.listen(config.port);

    Logger.log(`Backend API listening on port ${config.port}`, 'ApiBootstrap');
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  captureBootstrapFailure(error, 'api');
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  Logger.error(message, stack, 'ApiBootstrap');
  process.exitCode = 1;
});
