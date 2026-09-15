import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { buildQuery, fail, ok } from '../shared.js';

/**
 * Catalog Pattern read/moderation tools and the Staff Picks collection.
 */
export function registerPatternTools(server: McpServer, client: AdminClient): void {
  const uniquePatternIds = z
    .array(z.uuidv4())
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, 'patternIds must be unique');
  server.registerTool(
    'admin_list_patterns',
    {
      title: 'List catalog patterns',
      description: 'Lists Official/Community Patterns visible to the admin console, with status filter, search, and pagination.',
      inputSchema: {
        status: z.enum(['available', 'withdrawn', 'removed']).optional(),
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ status, search, page, pageSize }) => {
      try {
        const query = buildQuery({ status, search, page, pageSize });
        const result = await client.request('GET', `/patterns${query}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_get_pattern',
    {
      title: 'Get one pattern',
      description: 'Fetches full admin detail for one Pattern by id.',
      inputSchema: { id: z.uuidv4() },
    },
    async ({ id }) => {
      try {
        const result = await client.request('GET', `/patterns/${id}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_update_pattern_metadata',
    {
      title: 'Update a pattern\'s catalog metadata',
      description:
        'Updates title, creatorName, categoryCode, and tagCodes for an existing Pattern (backend PUT ' +
        '/admin/patterns/:id/metadata). categoryCode must be an active Catalog Category code — see ' +
        'admin_list_categories. This is a full replacement of these fields, not a partial patch.',
      inputSchema: {
        id: z.uuidv4(),
        title: z.string().min(1).max(255),
        creatorName: z.string().min(1).max(255),
        categoryCode: z.string().min(1).max(64),
        tagCodes: z.array(z.string()).max(5),
      },
    },
    async ({ id, title, creatorName, categoryCode, tagCodes }) => {
      try {
        const result = await client.request('PUT', `/patterns/${id}/metadata`, {
          title,
          creatorName,
          categoryCode,
          tagCodes,
        });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_set_pattern_paid',
    {
      title: 'Make one Official Pattern paid or free',
      description:
        'Changes an eligible Official Pattern in available, withdrawn, or review_hold to paid/free. ' +
        'The backend derives the paid tier from stitchable-cell count. Free-to-paid grants a zero-cost ' +
        'Grandfathered Pattern Unlock to every account/guest with a Stitching Session; paid-to-free keeps ' +
        'unlocks and gives no refund. Errors: pattern_not_found, pattern_not_eligible, or ' +
        'stitchable_cell_count_unknown.',
      inputSchema: { id: z.uuidv4(), paid: z.boolean() },
    },
    async ({ id, paid }) => {
      try {
        return ok(await client.request('PUT', `/patterns/${id}/paid`, { paid }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_bulk_set_patterns_paid',
    {
      title: 'Make Official Patterns paid or free in bulk',
      description:
        'Changes 1-50 unique Pattern ids to paid/free. Eligible Patterns are Official and available, ' +
        'withdrawn, or review_hold. Paid tiers are derived from stitchable-cell count; free-to-paid ' +
        'grandfathers every account/guest with a Stitching Session, while paid-to-free keeps unlocks and ' +
        'gives no refund. Results may partially succeed and report changed, unchanged, or failed with ' +
        'pattern_not_found, pattern_not_eligible, stitchable_cell_count_unknown, or internal_error.',
      inputSchema: { patternIds: uniquePatternIds, paid: z.boolean() },
    },
    async ({ patternIds, paid }) => {
      try {
        return ok(await client.request('POST', '/patterns/bulk-paid', { patternIds, paid }));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_withdraw_pattern',
    {
      title: 'Withdraw a pattern',
      description: 'Withdraws a Pattern from the catalog (reversible via admin_restore_pattern).',
      inputSchema: { id: z.uuidv4() },
    },
    async ({ id }) => {
      try {
        const result = await client.request('POST', `/patterns/${id}/withdraw`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_remove_pattern',
    {
      title: 'Remove a pattern',
      description: 'Removes a Pattern from the catalog (moderation-style takedown, reversible via admin_restore_pattern).',
      inputSchema: { id: z.uuidv4() },
    },
    async ({ id }) => {
      try {
        const result = await client.request('POST', `/patterns/${id}/remove`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_restore_pattern',
    {
      title: 'Restore a pattern',
      description: 'Restores a withdrawn or removed Pattern back to available.',
      inputSchema: { id: z.uuidv4() },
    },
    async ({ id }) => {
      try {
        const result = await client.request('POST', `/patterns/${id}/restore`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_list_staff_picks',
    {
      title: 'List Staff Picks',
      description: 'Lists the operator-curated Staff Picks collection in display order (backend GET /admin/staff-picks).',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await client.request('GET', '/staff-picks');
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_add_staff_pick',
    {
      title: 'Add (or move) a Pattern in Staff Picks',
      description:
        'Adds an available catalog Pattern to Staff Picks, or moves it if already present. The backend ' +
        'only exposes an atomic full-list replace (PUT /admin/staff-picks) — no single-item add endpoint ' +
        '(ADR-0039) — so this reads the current ordered list, removes any existing entry for patternId, ' +
        'inserts it at the given 1-based position (or appends it at the end if position is omitted), and ' +
        'writes the full list back in one PUT. The Pattern must currently be an available catalog Pattern.',
      inputSchema: {
        patternId: z.uuidv4(),
        position: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based target position; omit to append at the end'),
      },
    },
    async ({ patternId, position }) => {
      try {
        const current = (await client.request('GET', '/staff-picks')) as { patternId: string }[];
        const withoutTarget = current.map((pick) => pick.patternId).filter((id) => id !== patternId);
        const insertAt =
          position === undefined ? withoutTarget.length : Math.min(position - 1, withoutTarget.length);
        const patternIds = [
          ...withoutTarget.slice(0, insertAt),
          patternId,
          ...withoutTarget.slice(insertAt),
        ];
        const result = await client.request('PUT', '/staff-picks', { patternIds });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );
}
