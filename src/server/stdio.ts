import { serveStdio } from '@modelcontextprotocol/server/stdio';

import type { ServerDependencies } from './dependencies.js';
import { buildServer } from './build-server.js';

export function serveLocalStdio(dependencies: ServerDependencies): void {
  serveStdio(() => buildServer(dependencies), {
    legacy: 'serve',
    onerror: (error) => dependencies.logger.error({ err: error }, 'Erro no transporte stdio'),
  });
  dependencies.logger.info('D4Sign MCP executando via stdio');
}
