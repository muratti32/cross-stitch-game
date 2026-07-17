import 'dotenv/config';
import { NestFactory } from '@nestjs/core';

import { ApiAppModule } from '../src/app.api.module';
import { OperatorProvisioningService } from '../src/admin/operator-provisioning.service';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline !== undefined) {
    return inline.slice(prefix.length);
  }
  const flagIndex = process.argv.indexOf(`--${name}`);
  if (flagIndex !== -1 && process.argv[flagIndex + 1] !== undefined) {
    return process.argv[flagIndex + 1];
  }
  return undefined;
}

async function run(): Promise<void> {
  const email = readArg('email');
  const password = readArg('password');

  if (email === undefined || password === undefined) {
    console.error(
      'Usage: npm run operator:create -- --email owner@example.com --password "a-strong-password"',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(ApiAppModule);
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

run().catch((error: unknown) => {
  console.error('Unhandled error creating operator account:', error);
  process.exit(1);
});
