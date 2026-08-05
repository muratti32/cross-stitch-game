import 'dotenv/config';

import { runCreateOperator } from './admin/create-operator.cli';

void runCreateOperator(process.argv.slice(2)).catch((error: unknown) => {
  console.error('Unhandled error creating operator account:', error);
  process.exit(1);
});
