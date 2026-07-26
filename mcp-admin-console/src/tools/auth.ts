import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AdminClient } from '../admin-client.js';
import { fail, ok, requiredEnv } from '../shared.js';

/**
 * Operator login, MFA verification, and logout (ADR-0039).
 */
export function registerAuthTools(server: McpServer, client: AdminClient): void {
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
}
