import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { OperatorApiClient } from '../src/admin/paid-pattern-rollout/operator-api-client';
import {
  parseRolloutArgs,
  runPaidPatternRollout,
  type PaidPatternRolloutReport,
} from '../src/admin/paid-pattern-rollout/paid-pattern-rollout';

async function main(): Promise<void> {
  try {
    const options = parseRolloutArgs(process.argv.slice(2), process.env);
    const exitCode = await runPaidPatternRollout(options, {
      client: new OperatorApiClient(options.apiUrl),
      clock: () => new Date(),
      output: (line) => console.log(line),
      reportWriter: writeReport,
    });
    process.exitCode = exitCode;
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : 'Paid Pattern rollout failed');
    process.exitCode = 1;
  }
}

async function writeReport(path: string, report: PaidPatternRolloutReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

void main();
