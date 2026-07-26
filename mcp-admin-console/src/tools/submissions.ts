import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { buildQuery, fail, ok } from '../shared.js';

/**
 * Tools for managing community catalog submissions in the review queue.
 */
export function registerSubmissionTools(server: McpServer, client: AdminClient): void {
  server.registerTool(
    'admin_list_submissions',
    {
      title: 'List Catalog Submissions',
      description:
        'Lists pending catalog submissions from the community review queue (backend GET /admin/catalog-submissions). ' +
        'Omitting the status returns all open review queue items (review_pending, quarantined, and appeal_pending). ' +
        'Any other status value will result in a 400 error from the backend.',
      inputSchema: {
        status: z.enum(['review_pending', 'quarantined', 'appeal_pending']).optional(),
      },
    },
    async ({ status }) => {
      try {
        const query = buildQuery({ status });
        const result = await client.request('GET', `/catalog-submissions${query}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_get_submission',
    {
      title: 'Get Catalog Submission Details',
      description:
        'Retrieves detailed information about a specific community catalog submission (backend GET /admin/catalog-submissions/:id) ' +
        'by its unique submission UUID.',
      inputSchema: {
        id: z.string().uuid(),
      },
    },
    async ({ id }) => {
      try {
        const result = await client.request('GET', `/catalog-submissions/${id}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_get_submission_preview',
    {
      title: 'Get Submission Image Preview',
      description:
        'Fetches and returns the rendered preview image of a submitted pattern (backend GET /admin/catalog-submissions/:id/preview). ' +
        'Returns the rendered PNG inline as an MCP image content block. A preview larger than this server\'s ' +
        'inline size cap is refused with an error rather than returned, in which case view it in the web ' +
        'operator console instead.',
      inputSchema: {
        id: z.string().uuid(),
      },
    },
    async ({ id }) => {
      try {
        const image = await client.requestBinary('GET', `/catalog-submissions/${id}/preview`);
        return {
          content: [
            { type: 'image' as const, data: image.base64, mimeType: image.mimeType },
          ],
        };
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_accept_submission',
    {
      title: 'Accept Catalog Submission',
      description:
        'Accepts a player\'s catalog submission, publishing it to the community catalog (backend POST /admin/catalog-submissions/:id/accept). ' +
        'This decision affects real player submissions and is not reversible through these tools. ' +
        'An optional note (max 2000 characters) can be provided as an internal operator explanation.',
      inputSchema: {
        id: z.string().uuid(),
        note: z.string().max(2000).optional(),
      },
    },
    async ({ id, note }) => {
      try {
        const result = await client.request('POST', `/catalog-submissions/${id}/accept`, { note });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_reject_submission',
    {
      title: 'Reject Catalog Submission',
      description:
        'Rejects a player\'s catalog submission (backend POST /admin/catalog-submissions/:id/reject). ' +
        'This decision affects real player submissions and is not reversible through these tools. ' +
        'A rejection reason is mandatory and must be one of: safety, publication_rights, duplicate_or_spam, ' +
        'technical_invalidity, or quality_standard. An optional internal note (max 2000 characters) may also be provided.',
      inputSchema: {
        id: z.string().uuid(),
        reason: z.enum([
          'safety',
          'publication_rights',
          'duplicate_or_spam',
          'technical_invalidity',
          'quality_standard',
        ]),
        note: z.string().max(2000).optional(),
      },
    },
    async ({ id, reason, note }) => {
      try {
        const result = await client.request('POST', `/catalog-submissions/${id}/reject`, { reason, note });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );
}
