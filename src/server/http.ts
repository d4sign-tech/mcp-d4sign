import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node';

import type { AppConfig } from '../config/types.js';
import { createAccessTokenVerifier, AuthenticationError } from '../auth/access-token-verifier.js';
import { SCOPES } from '../auth/scopes.js';
import { UploadError } from '../d4sign/errors.js';
import { validateUploadFile } from '../d4sign/file-validation.js';
import { InMemoryRateLimiter, type RateLimiter } from '../infra/rate-limiter.js';
import { AuthorizationServerMetadata, advertisedScopes, isMetadataFacadeEnabled } from './authorization-server-metadata.js';
import { normalizeRequestId, runWithRequestContext } from '../infra/request-context.js';
import type { ServerDependencies } from './dependencies.js';
import { buildServer } from './build-server.js';

type AuthenticatedRequest = IncomingMessage & { auth?: AuthInfo };

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (status === 204) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of req) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    total += chunk.length;
    if (total > limit) throw new RangeError('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (total === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function readRawBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of req) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    total += chunk.length;
    if (total > limit) throw new RangeError('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function authContext(auth: AuthInfo): { principalId: string; tenantId: string } {
  const principal = auth.extra?.principalId;
  const tenant = auth.extra?.tenantId;
  return {
    principalId: typeof principal === 'string' && principal.length > 0 ? principal : auth.clientId,
    tenantId: typeof tenant === 'string' && tenant.length > 0 ? tenant : auth.clientId,
  };
}

function rateLimitKey(auth: AuthInfo, pathname: string): string {
  const context = authContext(auth);
  return createHash('sha256')
    .update(context.tenantId)
    .update('\0')
    .update(context.principalId)
    .update('\0')
    .update(pathname)
    .digest('hex');
}

/**
 * Chave anônima para o limite pré-autenticação.
 *
 * Atrás de ALB o IP do cliente vem em `X-Forwarded-For`; o último salto é o
 * próprio balanceador, então o primeiro elemento é o cliente. `drop_invalid_
 * header_fields` no ALB e o hash aqui evitam que o valor entre cru em métrica.
 */
function anonymousRateLimitKey(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const source = first !== undefined && first.length > 0 ? first : req.socket.remoteAddress ?? 'unknown';
  return createHash('sha256').update('anon').update('\0').update(source).digest('hex');
}

function toolNameFromBody(body: unknown): string | undefined {
  const candidates = Array.isArray(body) ? body : [body];
  for (const entry of candidates) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record.method !== 'tools/call' || typeof record.params !== 'object' || record.params === null) continue;
    const name = (record.params as Record<string, unknown>).name;
    if (typeof name === 'string' && /^[a-z0-9_.-]{1,128}$/u.test(name)) return name;
  }
  return undefined;
}

function protectedResourceMetadata(config: AppConfig, req: IncomingMessage): Record<string, unknown> {
  const requestBase = `http://${req.headers.host ?? 'localhost'}`;
  const base = config.publicBaseUrl ?? requestBase;
  const resource = `${base}/mcp`;
  // Com a camada de metadata ativa, o authorization server anunciado é esta
  // origem: é ela que publica PKCE, que o provedor real não declara.
  const facade = isMetadataFacadeEnabled(config);
  const authorizationServer = facade ? base : (config.oidc?.issuer ?? base);
  const scopePrefix = config.oidc?.scopePrefix;
  return {
    resource,
    authorization_servers: [authorizationServer],
    scopes_supported: scopePrefix === undefined
      ? []
      : facade
        ? advertisedScopes(scopePrefix)
        : [...new Set(Object.values(SCOPES).map((scope) => scopePrefix.length === 0
          ? scope
          : `${scopePrefix}/${scope}`))],
    bearer_methods_supported: ['header'],
  };
}

export interface HttpServerOptions {
  /** Cliente HTTP usado para consultar a metadata do provedor de identidade. */
  fetchImpl?: typeof fetch;
}

export function createHttpServer(
  config: AppConfig,
  dependencies: ServerDependencies,
  options: HttpServerOptions = {},
): Server {
  const tokenVerifier = createAccessTokenVerifier(config);
  const authorizationServerMetadata = isMetadataFacadeEnabled(config) && config.oidc !== undefined && config.publicBaseUrl !== undefined
    ? new AuthorizationServerMetadata({
      issuer: config.publicBaseUrl,
      upstreamIssuer: config.oidc.issuer,
      scopePrefix: config.oidc.scopePrefix,
      logger: dependencies.logger,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    })
    : undefined;
  const rateLimiter: RateLimiter = dependencies.rateLimiter ?? new InMemoryRateLimiter();

  const validateHost = hostHeaderValidation(config.allowedHosts);
  const validateOrigin = originValidation(config.allowedOriginHosts);
  const mcp = createMcpHandler(() => buildServer(dependencies), {
    legacy: 'stateless',
    responseMode: 'auto',
    onerror: (error) => dependencies.logger.error({ err: error }, 'Erro no handler MCP'),
  });
  const handleMcp = toNodeHandler(mcp, {
    onerror: (error) => dependencies.logger.error({ err: error }, 'Erro no adaptador HTTP MCP'),
  });
  const handleNodeMcp = handleMcp as unknown as (
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ) => Promise<void>;

  const handleRequestInner = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

      // Sondas de liveness/readiness precedem a validação de Host porque o ALB
      // e o agente ECS chegam com o IP da task no header.
      if (req.method === 'GET' && pathname === '/health/live') {
        writeJson(res, 200, { status: 'ok' }, { 'Cache-Control': 'no-store' });
        return;
      }
      if (req.method === 'GET' && pathname === '/health/ready') {
        const report = await (dependencies.readiness?.() ?? Promise.resolve({ ready: true, checks: {} }));
        writeJson(
          res,
          report.ready ? 200 : 503,
          { status: report.ready ? 'ready' : 'degraded', checks: report.checks },
          { 'Cache-Control': 'no-store' },
        );
        return;
      }
      if (!validateHost(req, res) || !validateOrigin(req, res)) return;

      // Limite por origem antes de qualquer verificação criptográfica, para que
      // um flood com tokens inválidos não consuma CPU de validação JWT.
      const anonymous = await rateLimiter.consume(
        anonymousRateLimitKey(req),
        config.mcpAnonymousRequestsPerMinute,
        60_000,
      );
      if (!anonymous.allowed) {
        dependencies.logger.warn({ event: 'mcp_anonymous_rate_limit_blocked', pathname }, 'Rate limit anônimo excedido');
        writeJson(res, 429, { error: 'rate_limited', retryAfterSeconds: anonymous.retryAfterSeconds }, {
          'Retry-After': String(anonymous.retryAfterSeconds),
        });
        return;
      }

      if (
        req.method === 'GET'
        && (pathname === '/.well-known/oauth-protected-resource'
          || pathname === '/.well-known/oauth-protected-resource/mcp')
      ) {
        writeJson(res, 200, protectedResourceMetadata(config, req), { 'Cache-Control': 'public, max-age=300' });
        return;
      }
      if (
        req.method === 'GET'
        && pathname === '/.well-known/oauth-authorization-server'
        && authorizationServerMetadata !== undefined
      ) {
        try {
          writeJson(res, 200, await authorizationServerMetadata.get(), { 'Cache-Control': 'public, max-age=300' });
        } catch {
          writeJson(res, 503, { error: 'authorization_server_metadata_unavailable' }, { 'Retry-After': '30' });
        }
        return;
      }
      if (pathname !== '/mcp' && pathname !== '/uploads' && pathname !== '/credentials/d4sign') {
        writeJson(res, 404, { error: 'not_found' });
        return;
      }

      let auth: AuthInfo;
      try {
        auth = await tokenVerifier.verify(req.headers.authorization);
      } catch (error) {
        const reason = error instanceof AuthenticationError ? error.reason : 'invalid_token';
        const base = config.publicBaseUrl ?? `http://${req.headers.host ?? 'localhost'}`;
        writeJson(res, 401, { error: 'unauthorized' }, {
          'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", error="${reason}"`,
        });
        return;
      }
      (req as AuthenticatedRequest).auth = auth;

      const limit = pathname === '/uploads' ? config.mcpUploadsPerMinute : config.mcpRequestsPerMinute;
      const limited = await rateLimiter.consume(rateLimitKey(auth, pathname), limit, 60_000);
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(limited.remaining));
      if (!limited.allowed) {
        dependencies.logger.warn({ event: 'mcp_rate_limit_blocked', pathname }, 'Rate limit MCP excedido');
        writeJson(res, 429, { error: 'rate_limited', retryAfterSeconds: limited.retryAfterSeconds }, {
          'Retry-After': String(limited.retryAfterSeconds),
        });
        return;
      }

      if (pathname === '/credentials/d4sign') {
        if (!auth.scopes.includes(SCOPES.credentialsWrite)) {
          writeJson(res, 403, { error: 'insufficient_scope', requiredScope: SCOPES.credentialsWrite });
          return;
        }
        if (dependencies.credentialStore === undefined) {
          writeJson(res, 404, { error: 'credential_management_unavailable' });
          return;
        }
        if (req.method === 'PUT') {
          let body: unknown;
          try {
            body = await readJsonBody(req, config.mcpMaxBodyBytes);
          } catch {
            writeJson(res, 400, { error: 'invalid_json' });
            return;
          }
          if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            writeJson(res, 400, { error: 'invalid_credentials_payload' });
            return;
          }
          const candidate = body as Record<string, unknown>;
          if (
            typeof candidate.tokenApi !== 'string'
            || candidate.tokenApi.trim().length === 0
            || (candidate.environment !== 'sandbox' && candidate.environment !== 'production')
            || typeof candidate.requestsPerHour !== 'number'
            || !Number.isInteger(candidate.requestsPerHour)
            || candidate.requestsPerHour < 1
            || candidate.requestsPerHour > 1_000_000
            || (candidate.cryptKey !== undefined && typeof candidate.cryptKey !== 'string')
          ) {
            writeJson(res, 400, { error: 'invalid_credentials_payload' });
            return;
          }
          await dependencies.credentialStore.setCredentials(authContext(auth), {
            tokenApi: candidate.tokenApi,
            environment: candidate.environment,
            requestsPerHour: candidate.requestsPerHour,
            ...(typeof candidate.cryptKey === 'string' && candidate.cryptKey.length > 0 ? { cryptKey: candidate.cryptKey } : {}),
          });
          dependencies.logger.info(
            { auditEvent: 'd4sign_credentials_rotated', ...authContext(auth) },
            'Credenciais D4Sign cadastradas ou rotacionadas',
          );
          writeJson(res, 204, undefined, { 'Cache-Control': 'no-store' });
          return;
        }
        if (req.method === 'DELETE') {
          await dependencies.credentialStore.deleteCredentials(authContext(auth));
          dependencies.logger.info(
            { auditEvent: 'd4sign_credentials_revoked', ...authContext(auth) },
            'Credenciais D4Sign revogadas',
          );
          writeJson(res, 204, undefined, { 'Cache-Control': 'no-store' });
          return;
        }
        writeJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'PUT, DELETE' });
        return;
      }

      if (pathname === '/uploads') {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
          return;
        }
        const declaredLength = Number(req.headers['content-length'] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > config.d4sign.maxUploadBytes) {
          writeJson(res, 413, { error: 'upload_too_large' });
          return;
        }
        const fileNameHeader = req.headers['x-file-name'];
        const mimeTypeHeader = req.headers['content-type'];
        if (typeof fileNameHeader !== 'string' || typeof mimeTypeHeader !== 'string') {
          writeJson(res, 400, { error: 'missing_upload_metadata' });
          return;
        }
        try {
          const bytes = await readRawBody(req, config.d4sign.maxUploadBytes);
          const file = validateUploadFile({
            bytes,
            fileName: fileNameHeader,
            mimeType: mimeTypeHeader.split(';', 1)[0] ?? '',
            maxBytes: config.d4sign.maxUploadBytes,
          });
          const receipt = await dependencies.uploadStore.put(authContext(auth), file);
          writeJson(res, 201, receipt, { 'Cache-Control': 'no-store' });
        } catch (error) {
          if (error instanceof RangeError) {
            writeJson(res, 413, { error: 'upload_too_large' });
          } else if (error instanceof UploadError) {
            writeJson(res, 400, { error: 'invalid_upload', message: error.message });
          } else {
            throw error;
          }
        }
        return;
      }

      const declaredLength = Number(req.headers['content-length'] ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > config.mcpMaxBodyBytes) {
        writeJson(res, 413, { error: 'request_too_large' });
        return;
      }

      if (req.method === 'POST') {
        let parsedBody: unknown;
        try {
          parsedBody = await readJsonBody(req, config.mcpMaxBodyBytes);
        } catch (error) {
          if (error instanceof RangeError) {
            writeJson(res, 413, { error: 'request_too_large' });
          } else {
            writeJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
          }
          return;
        }
        const toolName = toolNameFromBody(parsedBody);
        const toolStartedAt = performance.now();
        if (toolName !== undefined) {
          dependencies.logger.info({ event: 'mcp_tool_call', toolName, outcome: 'started' }, 'Tool MCP iniciada');
        }
        try {
          await handleNodeMcp(req, res, parsedBody);
          if (toolName !== undefined) {
            dependencies.logger.info({
              event: 'mcp_tool_call',
              toolName,
              outcome: 'completed',
              durationMs: Math.round(performance.now() - toolStartedAt),
            }, 'Tool MCP concluída');
          }
        } catch (error) {
          if (toolName !== undefined) {
            dependencies.logger.error({
              event: 'mcp_tool_call',
              toolName,
              outcome: 'failed',
              durationMs: Math.round(performance.now() - toolStartedAt),
              err: error,
            }, 'Tool MCP falhou');
          }
          throw error;
        }
        return;
      }

      await handleNodeMcp(req, res);
    } catch (error) {
      dependencies.logger.error({ err: error }, 'Erro HTTP não tratado');
      if (!res.headersSent) writeJson(res, 500, { error: 'internal_error' });
      else res.end();
    }
  };

  return createServer((req, res) => {
    const requestId = normalizeRequestId(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', requestId);
    const startedAt = performance.now();
    res.once('finish', () => dependencies.logger.info({
      event: 'http_request',
      method: req.method,
      pathname: new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname,
      statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    }, 'Requisição HTTP concluída'));
    void runWithRequestContext(requestId, () => handleRequestInner(req, res));
  });
}

/**
 * Encerramento gracioso com prazo.
 *
 * `server.close()` sozinho espera todas as conexões: um stream SSE com
 * keep-alive nunca fica idle e o callback pode não disparar, levando o ECS a
 * enviar SIGKILL e derrubar rodadas de confirmação em voo. Aqui as conexões
 * ociosas caem imediatamente, as ativas ganham `mcpShutdownGraceMs` para
 * terminar, e o que sobrar é fechado à força antes de liberar as dependências.
 */
export async function shutdownHttpServer(
  server: Server,
  dependencies: ServerDependencies,
  graceMs: number,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      dependencies.logger.warn({ graceMs }, 'Prazo de drenagem HTTP esgotado; fechando conexões restantes');
      server.closeAllConnections();
      finish();
    }, graceMs);
    timer.unref();
    server.close((error) => {
      if (error !== undefined) dependencies.logger.error({ err: error }, 'Falha no encerramento HTTP');
      finish();
    });
    server.closeIdleConnections();
  });
  try {
    await dependencies.close?.();
  } catch (error) {
    dependencies.logger.error({ err: error }, 'Falha ao liberar dependências no encerramento');
  }
}

export async function serveHttp(config: AppConfig, dependencies: ServerDependencies): Promise<void> {
  const server = createHttpServer(config, dependencies);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  dependencies.logger.info({ host: config.host, port: config.port }, 'D4Sign MCP HTTP iniciado');

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    dependencies.logger.info({ signal }, 'Encerramento gracioso iniciado');
    void shutdownHttpServer(server, dependencies, config.mcpShutdownGraceMs).then(() => {
      dependencies.logger.info({ signal }, 'Encerramento gracioso concluído');
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
