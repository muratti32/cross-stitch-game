import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { buildQuery, fail, ok } from '../shared.js';

/**
 * Tools for reviewing creator-proposed metadata revisions for published patterns.
 */
export function registerMetadataRevisionTools(server: McpServer, client: AdminClient): void {
  server.registerTool(
    'admin_list_metadata_revisions',
    {
      title: 'List Catalog Metadata Revisions',
      description:
        'Lists pending metadata revisions submitted by pattern creators for review (backend GET /admin/catalog-metadata-revisions). ' +
        'Omitting the status returns both open statuses (pending and appeal_pending). ' +
        'Any other status value will result in a 400 error from the backend.',
      inputSchema: {
        status: z.enum(['pending', 'appeal_pending']).optional(),
      },
    },
    async ({ status }) => {
      try {
        const query = buildQuery({ status });
        const result = await client.request('GET', `/catalog-metadata-revisions${query}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_get_metadata_revision',
    {
      title: 'Get Metadata Revision Details',
      description:
        'Retrieves detailed information about a specific proposed catalog metadata revision (backend GET /admin/catalog-metadata-revisions/:id) ' +
        'by its unique revision UUID.',
      inputSchema: {
        id: z.string().uuid(),
      },
    },
    async ({ id }) => {
      try {
        const result = await client.request('GET', `/catalog-metadata-revisions/${id}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_accept_metadata_revision',
    {
      title: 'Accept Catalog Metadata Revision',
      description:
        'Accepts a proposed metadata revision for a published pattern (backend POST /admin/catalog-metadata-revisions/:id/accept). ' +
        'This action approves a change proposed by a creator, applying it to the live pattern. ' +
        'Note that this is distinct from directly editing pattern metadata (which is done via admin_update_pattern_metadata). ' +
        'This decision is not reversible through these tools. ' +
        'An optional note (max 2000 characters) can be provided as an internal operator explanation.',
      inputSchema: {
        id: z.string().uuid(),
        note: z.string().max(2000).optional(),
      },
    },
    async ({ id, note }) => {
      try {
        const result = await client.request('POST', `/catalog-metadata-revisions/${id}/accept`, { note });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_reject_metadata_revision',
    {
      title: 'Reject Catalog Metadata Revision',
      description:
        'Rejects a proposed metadata revision for a published pattern (backend POST /admin/catalog-metadata-revisions/:id/reject). ' +
        'This action declines a change proposed by a creator. ' +
        'Note that this is distinct from directly editing pattern metadata (which is done via admin_update_pattern_metadata). ' +
        'This decision is not reversible through these tools. ' +
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
        const result = await client.request('POST', `/catalog-metadata-revisions/${id}/reject`, { reason, note });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );
}
