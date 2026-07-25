import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { buildQuery, fail, ok } from '../shared.js';

/**
 * Official Pattern draft creation, polling, publishing, and discarding.
 */
export function registerDraftTools(server: McpServer, client: AdminClient): void {
  server.registerTool(
    'admin_create_pattern_draft',
    {
      title: 'Create an Official Pattern draft from a source image',
      description:
        'Uploads a local JPEG/PNG file and starts async conversion into an Official Pattern draft ' +
        '(backend POST /admin/pattern-drafts). Returns immediately with a draft id in Pending/Processing ' +
        'status — poll admin_get_pattern_draft until status is "ready", then call admin_publish_pattern_draft.',
      inputSchema: {
        imagePath: z.string().min(1).describe('Absolute local filesystem path to a JPEG or PNG source image'),
        shortEdgeCells: z.number().int().min(20).max(300),
        maxColors: z.number().int().min(5).max(60),
      },
    },
    async ({ imagePath, shortEdgeCells, maxColors }) => {
      try {
        const bytes = await readFile(imagePath);
        const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        const form = new FormData();
        form.set('shortEdgeCells', String(shortEdgeCells));
        form.set('maxColors', String(maxColors));
        form.set('sourceImage', new Blob([bytes], { type: mimeType }), basename(imagePath));
        const result = await client.requestForm('POST', '/pattern-drafts', form);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_list_pattern_drafts',
    {
      title: 'List Official Pattern drafts',
      description: 'Lists in-progress and completed Official Pattern drafts, with status filter and pagination.',
      inputSchema: {
        status: z.enum(['pending', 'processing', 'ready', 'failed', 'published', 'discarded']).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ status, page, pageSize }) => {
      try {
        const query = buildQuery({ status, page, pageSize });
        const result = await client.request('GET', `/pattern-drafts${query}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_get_pattern_draft',
    {
      title: 'Get one Official Pattern draft',
      description: 'Fetches status and conversion detail for one draft by id. Use this to poll until status is "ready".',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      try {
        const result = await client.request('GET', `/pattern-drafts/${id}`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_get_pattern_draft_preview',
    {
      title: 'Get Pattern Draft Image Preview',
      description:
        'Fetches and returns the rendered preview image of a pattern draft (backend GET /admin/pattern-drafts/:id/preview). ' +
        'Renders the converted draft preview PNG inline as an MCP image content block, allowing the operator to visually check ' +
        'the draft before publishing it via admin_publish_pattern_draft.',
      inputSchema: {
        id: z.string().uuid(),
      },
    },
    async ({ id }) => {
      try {
        const image = await client.requestBinary('GET', `/pattern-drafts/${id}/preview`);
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
    'admin_publish_pattern_draft',
    {
      title: 'Publish a ready draft as an Official Pattern',
      description:
        'Publishes a "ready" draft into the live catalog (backend POST /admin/pattern-drafts/:id/publish). ' +
        'categoryCode must be an active Catalog Category code — see admin_list_categories. paid=true prices ' +
        'the Pattern by its stitchable-cell count (Pattern Unlock Price Tier); the console never sets a ' +
        'price directly.',
      inputSchema: {
        id: z.string().uuid(),
        title: z.string().min(1).max(255),
        creatorName: z.string().min(1).max(255),
        categoryCode: z.string().min(1).max(64),
        tagCodes: z.array(z.string()).max(5),
        paid: z.boolean(),
      },
    },
    async ({ id, title, creatorName, categoryCode, tagCodes, paid }) => {
      try {
        const result = await client.request('POST', `/pattern-drafts/${id}/publish`, {
          title,
          creatorName,
          categoryCode,
          tagCodes,
          paid,
        });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_discard_pattern_draft',
    {
      title: 'Discard a pattern draft',
      description: 'Discards a draft that will not be published (backend POST /admin/pattern-drafts/:id/discard).',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      try {
        const result = await client.request('POST', `/pattern-drafts/${id}/discard`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );
}
