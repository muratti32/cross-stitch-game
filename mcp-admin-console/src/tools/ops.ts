import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { fail, ok } from '../shared.js';

/**
 * Operational tools including alerts, reconciliation, and support reference lookups.
 */
export function registerOpsTools(server: McpServer, client: AdminClient): void {
  server.registerTool(
    'admin_list_operational_alerts',
    {
      title: 'List Operational Alerts',
      description:
        'Retrieves the latest operational alerts (backend GET /admin/operational-alerts) for queue depth, ' +
        'webhook failures, job failures, and promotion anomalies. This is a read-only diagnostics operation.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await client.request('GET', '/operational-alerts');
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_get_reconciliation_findings',
    {
      title: 'Get Reconciliation Findings',
      description:
        'Retrieves the latest reconciliation findings (backend GET /admin/reconciliation) containing ledger ' +
        'and entitlement mismatches detected by the background reconciliation job. This is a read-only operation.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await client.request('GET', '/reconciliation');
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_lookup_support_reference',
    {
      title: 'Lookup Support Reference Code',
      description:
        'Resolves a support reference code quoted by a player back to the underlying player account or record ' +
        '(backend POST /admin/support-references/lookup). This operation deanonymizes the player\'s support code. ' +
        'The justification reason is mandatory and is written directly to the operator audit log. ' +
        'This tool must only be used when working on an active support ticket.',
      inputSchema: {
        code: z.string().min(10).max(24),
        reason: z
          .string()
          .min(10)
          .max(500)
          .describe(
            'Mandatory justification written to the operator audit log. Must contain a real support ' +
              'ticket reference or explanation, not filler text.',
          ),
      },
    },
    async ({ code, reason }) => {
      try {
        const result = await client.request('POST', '/support-references/lookup', { code, reason });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );
}
