import { McpServer } from '@modelcontextprotocol/server';

import { createAuthorizer } from '../auth/authorize.js';
import type { ServerDependencies } from './dependencies.js';
import { registerAllTools } from '../tools/register-all.js';

export const SERVER_INSTRUCTIONS =
  'Use UUIDs D4Sign exatos e liste objetos quando não forem conhecidos. Upload multipart requer handle criado fora da conversa por POST /uploads. Operações sensíveis e remoções abrangentes exigem confirmação. Respeite a cota configurada da conta.';

export function buildServer(dependencies: ServerDependencies): McpServer {
  const server = new McpServer(
    { name: 'd4sign-mcp', version: '0.4.0' },
    {
      instructions: SERVER_INSTRUCTIONS,
      capabilities: { tools: {} },
      cacheHints: {
        'server/discover': { ttlMs: 300_000, cacheScope: 'private' },
        'tools/list': { ttlMs: 300_000, cacheScope: 'private' },
      },
      inputRequired: { maxRounds: 2, roundTimeoutMs: 600_000, legacyShim: true },
      requestState: { verify: dependencies.confirmationWorkflow.verifyRequestState },
    },
  );
  registerAllTools(
    server,
    dependencies.readService,
    dependencies.writeService,
    dependencies.fileService,
    dependencies.confirmationWorkflow,
    createAuthorizer(dependencies.transport),
  );
  return server;
}
