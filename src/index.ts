import { loadConfig } from './config/env.js';
import { createLogger } from './infra/logger.js';
import { createDependencies } from './server/dependencies.js';
import { serveHttp } from './server/http.js';
import { serveLocalStdio } from './server/stdio.js';

const mode = process.argv[2] ?? 'stdio';
if (mode !== 'http' && mode !== 'stdio') {
  throw new Error(`Modo inválido: ${mode}. Use "http" ou "stdio".`);
}

const config = loadConfig();
const logger = createLogger(config.logLevel);

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promise rejeitada sem tratamento');
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Exceção não capturada; encerrando');
  process.exitCode = 1;
  process.exit(1);
});

const dependencies = await createDependencies(config, logger, undefined, mode);

if (mode === 'http') {
  await serveHttp(config, dependencies);
} else {
  serveLocalStdio(dependencies);
}
