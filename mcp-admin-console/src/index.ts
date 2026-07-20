#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

dotenv.config({
  path: join(dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
});
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { AdminApiError, AdminClient } from './admin-client.js';

// Mirrors backend/src/catalog/catalog.constants.ts FIXED_CATEGORIES. The
// admin API has no endpoint to list these — they are a fixed enum enforced
// server-side in admin-catalog.service.ts.
const CATEGORY_CODES = [
  'animals',
  'nature-flowers',
  'people',
  'places-architecture',
  'food-drink',
  'holidays-seasons',
  'fantasy',
  'geometric-abstract',
  'words-symbols',
  'other',
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const baseUrl = process.env.ADMIN_API_URL ?? 'http://localhost:3000';
const client = new AdminClient(baseUrl);

const server = new McpServer({
  name: 'cross-stitch-admin-console',
  version: '0.1.0',
});

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown) {
  if (error instanceof AdminApiError) {
    return {
      content: [
        { type: 'text' as const, text: `Admin API error ${error.status}: ${JSON.stringify(error.body)}` },
      ],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

server.registerTool(
  'admin_login',
  {
    title: 'Log in to the operator console',
    description:
      'Logs in using ADMIN_EMAIL/ADMIN_PASSWORD from the environment. The backend always requires MFA ' +
      '(ADR-0039) and this call never skips it: if ADMIN_TOTP_SECRET is also set, this generates the ' +
      "current code itself and completes login in one step (status: \"authenticated\"). Without " +
      'ADMIN_TOTP_SECRET, this only returns an mfa_required challenge — follow up with admin_verify_mfa ' +
      "and the operator's current 6-digit TOTP code.",
    inputSchema: {},
  },
  async () => {
    try {
      const email = requiredEnv('ADMIN_EMAIL');
      const password = requiredEnv('ADMIN_PASSWORD');
      const totpSecret = process.env.ADMIN_TOTP_SECRET;
      const result = await client.login(email, password, totpSecret);
      return ok(result);
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  'admin_verify_mfa',
  {
    title: 'Complete operator login with a TOTP code',
    description:
      'Completes the login started by admin_login using the operator\'s current 6-digit authenticator ' +
      'code, or a single-use recovery code. On success the session (access + refresh token) is held in ' +
      'memory for the rest of this MCP server process.',
    inputSchema: {
      totpCode: z.string().regex(/^\d{6}$/).optional().describe('Current 6-digit TOTP code'),
      recoveryCode: z.string().min(1).optional().describe('Single-use recovery code, instead of a TOTP code'),
    },
  },
  async ({ totpCode, recoveryCode }) => {
    try {
      if (totpCode === undefined && recoveryCode === undefined) {
        throw new Error('Provide either totpCode or recoveryCode');
      }
      const result = await client.verifyMfa({ totpCode, recoveryCode });
      return ok(result);
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  'admin_logout',
  {
    title: 'End the operator session',
    description: 'Revokes the current operator refresh token and clears the in-memory session.',
    inputSchema: {},
  },
  async () => {
    try {
      await client.logout();
      return ok({ status: 'logged_out' });
    } catch (error) {
      return fail(error);
    }
  },
);

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
    inputSchema: { id: z.string().uuid() },
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
      '/admin/patterns/:id/metadata). categoryCode must be one of: ' +
      CATEGORY_CODES.join(', ') +
      '. This is a full replacement of these fields, not a partial patch.',
    inputSchema: {
      id: z.string().uuid(),
      title: z.string().min(1).max(255),
      creatorName: z.string().min(1).max(255),
      categoryCode: z.enum(CATEGORY_CODES),
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
  'admin_withdraw_pattern',
  {
    title: 'Withdraw a pattern',
    description: 'Withdraws a Pattern from the catalog (reversible via admin_restore_pattern).',
    inputSchema: { id: z.string().uuid() },
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
    inputSchema: { id: z.string().uuid() },
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
    inputSchema: { id: z.string().uuid() },
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
  'admin_publish_pattern_draft',
  {
    title: 'Publish a ready draft as an Official Pattern',
    description:
      'Publishes a "ready" draft into the live catalog (backend POST /admin/pattern-drafts/:id/publish). ' +
      'categoryCode must be one of: ' +
      CATEGORY_CODES.join(', ') +
      '. paid=true prices the Pattern by its stitchable-cell count (Pattern Unlock Price Tier); the console ' +
      'never sets a price directly.',
    inputSchema: {
      id: z.string().uuid(),
      title: z.string().min(1).max(255),
      creatorName: z.string().min(1).max(255),
      categoryCode: z.enum(CATEGORY_CODES),
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

server.registerTool(
  'admin_list_tags',
  {
    title: 'List Catalog Tags',
    description: 'Lists operator-managed Catalog Tags (code + localized labels) available to attach to Patterns.',
    inputSchema: {},
  },
  async () => {
    try {
      const result = await client.request('GET', '/tags');
      return ok(result);
    } catch (error) {
      return fail(error);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error starting cross-stitch admin console MCP server:', error);
  process.exit(1);
});
