import 'dotenv/config';

import { runCreateOperator } from '../src/admin/create-operator.cli';

// Development entrypoint (ts-node). The deployed image ships neither `scripts/`
// nor ts-node, so containers run the compiled twin instead:
// `npm run operator:create:prod` (dist/main.create-operator.js).
runCreateOperator(process.argv.slice(2)).catch((error: unknown) => {
  console.error('Unhandled error creating operator account:', error);
  process.exit(1);
});
