import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { buildQuery, fail, ok } from '../shared.js';

/**
 * Tools for auditing and replaying inbound webhook deliveries.
 */
export function registerWebhookDeliveryTools(server: McpServer, client: AdminClient): void {
  server.registerTool(
    'admin_list_webhook_deliveries',
    {
      title: 'List Webhook Deliveries',
      description:
        'Lists recorded inbound webhook deliveries (backend GET /admin/webhook-deliveries). ' +
        'Supports optional filtering by provider (revenuecat, admob, fal) and outcome (processed, ' +
        'duplicate_ignored, verification_failed, failed). Invalid filter values will be rejected with 400.',
      inputSchema: {
        provider: z.enum(['revenuecat', 'admob', 'fal']).optional(),
        outcome: z.enum(['processed', 'duplicate_ignored', 'verification_failed', 'failed']).optional(),
      },
    },
    async ({ provider, outcome }) => {
      try {
        const query = buildQuery({ provider, outcome });
        const result = await client.request('GET', `/webhook-deliveries${query}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_replay_webhook_delivery',
    {
      title: 'Replay Webhook Delivery',
      description:
        'Re-runs the recorded inbound webhook payload through the live processing pipeline ' +
        '(backend POST /admin/webhook-deliveries/:id/replay). This action has real side effects, ' +
        'such as granting entitlements or in-game currency. It is intended for recovering deliveries ' +
        'whose outcome was "failed". This action cannot be undone through these tools.',
      inputSchema: {
        id: z.string().uuid(),
      },
    },
    async ({ id }) => {
      try {
        const result = await client.request('POST', `/webhook-deliveries/${id}/replay`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );
}
