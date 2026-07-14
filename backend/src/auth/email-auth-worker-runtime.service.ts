import {
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';

import { EmailOutboxDispatcherService } from './email-outbox-dispatcher.service';

const EMAIL_OUTBOX_POLL_INTERVAL_MS = 1_000;
const EMAIL_OUTBOX_RETRY_INTERVAL_MS = 5_000;

@Injectable()
export class EmailAuthWorkerRuntimeService implements OnApplicationShutdown {
  private readonly logger = new Logger(EmailAuthWorkerRuntimeService.name);
  private activeDispatch: Promise<void> | null = null;
  private dispatchTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly dispatcher: EmailOutboxDispatcherService) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.dispatchTimer !== null) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    if (this.activeDispatch !== null) {
      await this.activeDispatch;
    }
  }

  onApplicationShutdown(): Promise<void> {
    return this.stop();
  }

  private schedule(delayMs: number): void {
    if (!this.running) {
      return;
    }
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      const dispatch = this.runDispatch();
      this.activeDispatch = dispatch;
      void dispatch.finally(() => {
        if (this.activeDispatch === dispatch) {
          this.activeDispatch = null;
        }
      });
    }, delayMs);
  }

  private async runDispatch(): Promise<void> {
    let nextDelay = EMAIL_OUTBOX_POLL_INTERVAL_MS;
    try {
      const dispatched = await this.dispatcher.dispatchOnce();
      if (dispatched > 0) {
        nextDelay = 0;
      }
    } catch (error: unknown) {
      nextDelay = EMAIL_OUTBOX_RETRY_INTERVAL_MS;
      this.logger.error(
        `Retrying email outbox dispatcher: ${errorMessage(error)}`,
        errorStack(error),
      );
    } finally {
      this.schedule(nextDelay);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
