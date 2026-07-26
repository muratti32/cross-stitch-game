#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
});
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { AdminClient } from './admin-client.js';
import { registerAuthTools } from './tools/auth.js';
import { registerCatalogTaxonomyTools } from './tools/catalog-taxonomy.js';
import { registerDraftTools } from './tools/drafts.js';
import { registerMetadataRevisionTools } from './tools/metadata-revisions.js';
import { registerOpsTools } from './tools/ops.js';
import { registerPatternTools } from './tools/patterns.js';
import { registerSubmissionTools } from './tools/submissions.js';
import { registerWebhookDeliveryTools } from './tools/webhook-deliveries.js';

const baseUrl = process.env.ADMIN_API_URL ?? 'http://localhost:3000';
const client = new AdminClient(baseUrl);

const server = new McpServer({
  name: 'cross-stitch-admin-console',
  version: '0.1.0',
});

registerAuthTools(server, client);
registerPatternTools(server, client);
registerDraftTools(server, client);
registerCatalogTaxonomyTools(server, client);
registerSubmissionTools(server, client);
registerMetadataRevisionTools(server, client);
registerWebhookDeliveryTools(server, client);
registerOpsTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error starting cross-stitch admin console MCP server:', error);
  process.exit(1);
});
