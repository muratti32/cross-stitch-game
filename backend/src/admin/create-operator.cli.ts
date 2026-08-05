import { NestFactory } from '@nestjs/core';

import { ApiAppModule } from '../app.api.module';
import { OperatorProvisioningService } from './operator-provisioning.service';

function readArg(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline !== undefined) {
    return inline.slice(prefix.length);
  }
  const flagIndex = argv.indexOf(`--${name}`);
  if (flagIndex !== -1 && argv[flagIndex + 1] !== undefined) {
    return argv[flagIndex + 1];
  }
  return undefined;
}

/**
 * Creates one owner Operator Account (ADR-0039: no HTTP endpoint for this).
 *
 * Credentials come from `--email` / `--password` flags, or from the
 * `OPERATOR_EMAIL` / `OPERATOR_PASSWORD` environment variables — the env form
 * exists so a deployed container can be provisioned without the password
 * landing in the process list or shell history.
 */
export async function runCreateOperator(argv: string[]): Promise<void> {
  const email = readArg(argv, 'email') ?? process.env.OPERATOR_EMAIL;
  const password = readArg(argv, 'password') ?? process.env.OPERATOR_PASSWORD;

  if (email === undefined || password === undefined) {
    console.error(
      'Usage: npm run operator:create -- --email owner@example.com --password "a-strong-password"\n' +
        '   or: OPERATOR_EMAIL=owner@example.com OPERATOR_PASSWORD="a-strong-password" npm run operator:create:prod',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(ApiAppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const provisioning = app.get(OperatorProvisioningService);
    const provisioned = await provisioning.createOperator(email, password);

    console.log('Operator account created.');
    console.log(`  id:    ${provisioned.operatorAccountId}`);
    console.log(`  email: ${provisioned.email}`);
    console.log('');
    console.log('Scan this into an authenticator app (otpauth URI, shown once):');
    console.log(`  ${provisioned.otpauthUri}`);
    console.log('');
    console.log('Single-use recovery codes (store these securely now; shown once):');
    for (const code of provisioned.recoveryCodes) {
      console.log(`  ${code}`);
    }
  } catch (error) {
    console.error('Error creating operator account:', error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}
