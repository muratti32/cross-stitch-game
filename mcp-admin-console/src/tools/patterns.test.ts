import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { registerPatternTools } from './patterns.js';

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface RecordedRequest {
  body: unknown;
  method: string;
  path: string;
}

function setup() {
  const configs = new Map<string, { inputSchema: Record<string, z.ZodType> }>();
  const handlers = new Map<string, ToolHandler>();
  const requests: RecordedRequest[] = [];
  const server = {
    registerTool(
      name: string,
      config: { inputSchema: Record<string, z.ZodType> },
      handler: ToolHandler,
    ): void {
      configs.set(name, config);
      handlers.set(name, handler);
    },
  };
  const client = {
    async request(method: string, path: string, body?: unknown): Promise<unknown> {
      requests.push({ body, method, path });
      return { ok: true };
    },
  };
  registerPatternTools(server as unknown as McpServer, client as unknown as AdminClient);
  return { client, configs, handlers, requests };
}

describe('Pattern paid MCP tools', () => {
  test('single and bulk handlers call the paid admin endpoints', async () => {
    const { handlers, requests } = setup();
    const id = '123e4567-e89b-42d3-a456-426614174000';
    await handlers.get('admin_set_pattern_paid')?.({ id, paid: true });
    await handlers.get('admin_bulk_set_patterns_paid')?.({ patternIds: [id], paid: false });
    assert.deepEqual(requests, [
      { body: { paid: true }, method: 'PUT', path: `/patterns/${id}/paid` },
      { body: { paid: false, patternIds: [id] }, method: 'POST', path: '/patterns/bulk-paid' },
    ]);
  });

  test('handlers return MCP errors when the admin client fails', async () => {
    const { client, handlers } = setup();
    client.request = async () => { throw new Error('request failed'); };
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const single = await handlers.get('admin_set_pattern_paid')?.({ id, paid: true });
    const bulk = await handlers.get('admin_bulk_set_patterns_paid')?.({ patternIds: [id], paid: true });
    assert.equal(single?.isError, true);
    assert.equal(bulk?.isError, true);
  });

  test('bulk input schema requires 1-50 unique v4 UUIDs', () => {
    const { configs } = setup();
    const inputSchema = configs.get('admin_bulk_set_patterns_paid')?.inputSchema;
    assert.ok(inputSchema);
    const schema = z.object(inputSchema);
    const id = '123e4567-e89b-42d3-a456-426614174000';
    const ids = Array.from(
      { length: 51 },
      (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    );

    assert.equal(schema.safeParse({ paid: true, patternIds: [id, id.toUpperCase()] }).success, false);
    assert.equal(schema.safeParse({ paid: true, patternIds: ids }).success, false);
    assert.equal(schema.safeParse({ paid: true, patternIds: [] }).success, false);
    assert.equal(schema.safeParse({ paid: true, patternIds: ['123e4567-e89b-12d3-a456-426614174000'] }).success, false);
    assert.equal(schema.safeParse({ paid: true, patternIds: [id] }).success, true);
  });
});
