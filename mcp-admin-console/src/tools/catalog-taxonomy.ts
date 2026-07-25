import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { fail, ok } from '../shared.js';

/**
 * Operator-managed Catalog Tags and Catalog Categories (ADR-0040).
 */
export function registerCatalogTaxonomyTools(server: McpServer, client: AdminClient): void {
  server.registerTool(
    'admin_list_tags',
    {
      title: 'List Catalog Tags',
      description: 'Lists operator-managed Catalog Tags (code + localized labels, active and inactive) available to attach to Patterns.',
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

  const tagLabelSchema = z.object({
    locale: z.string().min(2).max(8).describe('BCP-47-style locale code, e.g. "en" or "en-US"'),
    label: z.string().min(1).max(255),
  });

  server.registerTool(
    'admin_create_tag',
    {
      title: 'Create a new Catalog Tag',
      description:
        'Creates a new operator-managed Catalog Tag (backend POST /admin/tags). code must be lowercase ' +
        'letters, digits, and hyphens only, and must not already exist. labels needs at least one ' +
        '{locale, label} entry. The new tag is active immediately and can then be attached to Patterns via ' +
        'tagCodes (max 5 per Pattern) in admin_update_pattern_metadata or admin_publish_pattern_draft.',
      inputSchema: {
        code: z.string().max(64).regex(/^[a-z0-9-]+$/, 'code must be lowercase letters, digits, and hyphens only'),
        labels: z.array(tagLabelSchema).min(1),
      },
    },
    async ({ code, labels }) => {
      try {
        const result = await client.request('POST', '/tags', { code, labels });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_update_tag_labels',
    {
      title: "Update a Catalog Tag's localized labels",
      description:
        'Replaces the localized labels of an existing Catalog Tag by code (backend PUT ' +
        '/admin/tags/:code/labels). Needs at least one {locale, label} entry; this is a full replacement ' +
        'of the label set, not a partial patch. Does not change the tag\'s code or active status.',
      inputSchema: {
        code: z.string().min(1).max(64),
        labels: z.array(tagLabelSchema).min(1),
      },
    },
    async ({ code, labels }) => {
      try {
        const result = await client.request('PUT', `/tags/${encodeURIComponent(code)}/labels`, { labels });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_deactivate_tag',
    {
      title: 'Deactivate a Catalog Tag',
      description:
        'Deactivates a Catalog Tag by code (backend POST /admin/tags/:code/deactivate). Tags are ' +
        'deactivated rather than deleted once referenced — this is not reversible through this MCP server; ' +
        'reactivation, if ever needed, is a direct database/backend concern outside these tools.',
      inputSchema: { code: z.string().min(1).max(64) },
    },
    async ({ code }) => {
      try {
        const result = await client.request('POST', `/tags/${encodeURIComponent(code)}/deactivate`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_list_categories',
    {
      title: 'List Catalog Categories',
      description: 'Lists operator-managed Catalog Categories (code + label, active and inactive) available to assign to Patterns.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await client.request('GET', '/categories');
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_create_category',
    {
      title: 'Create a new Catalog Category',
      description:
        'Creates a new operator-managed Catalog Category (backend POST /admin/categories). code must be ' +
        'lowercase letters, digits, and hyphens only, and must not already exist. Unlike Catalog Tags, ' +
        'Category labels are a single value, not localized (ADR-0040). The new category is active ' +
        'immediately and can then be assigned via categoryCode in admin_update_pattern_metadata or ' +
        'admin_publish_pattern_draft.',
      inputSchema: {
        code: z.string().max(64).regex(/^[a-z0-9-]+$/, 'code must be lowercase letters, digits, and hyphens only'),
        label: z.string().min(1).max(255),
      },
    },
    async ({ code, label }) => {
      try {
        const result = await client.request('POST', '/categories', { code, label });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_update_category_label',
    {
      title: "Update a Catalog Category's label",
      description:
        'Replaces the label of an existing Catalog Category by code (backend PUT ' +
        '/admin/categories/:code/label). Does not change the category\'s code or active status.',
      inputSchema: {
        code: z.string().min(1).max(64),
        label: z.string().min(1).max(255),
      },
    },
    async ({ code, label }) => {
      try {
        const result = await client.request('PUT', `/categories/${encodeURIComponent(code)}/label`, { label });
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'admin_deactivate_category',
    {
      title: 'Deactivate a Catalog Category',
      description:
        'Deactivates a Catalog Category by code (backend POST /admin/categories/:code/deactivate). ' +
        'Categories are deactivated rather than deleted once referenced — this is not reversible through ' +
        'this MCP server; reactivation, if ever needed, is a direct database/backend concern outside these ' +
        'tools.',
      inputSchema: { code: z.string().min(1).max(64) },
    },
    async ({ code }) => {
      try {
        const result = await client.request('POST', `/categories/${encodeURIComponent(code)}/deactivate`);
        return ok(result);
      } catch (error) {
        return fail(error);
      }
    },
  );
}
