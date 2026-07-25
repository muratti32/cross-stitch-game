import './observability/sentry';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerAppModule } from './app.worker.module';
import { EmailAuthWorkerRuntimeService } from './auth';
import { JobsWorkerRuntimeService } from './jobs';
import { captureBootstrapFailure } from './observability';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule);

  try {
    app.enableShutdownHooks();

    const runtime = app.get(JobsWorkerRuntimeService);
    await runtime.start();
    app.get(EmailAuthWorkerRuntimeService).start();

    Logger.log('Backend worker started', 'WorkerBootstrap');
  } catch (error: unknown) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch((error: unknown) => {
  captureBootstrapFailure(error, 'worker');
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  Logger.error(message, stack, 'WorkerBootstrap');
  process.exitCode = 1;
});
