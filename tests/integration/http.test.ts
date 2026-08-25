import { once } from 'node:events';
import { Agent, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../src/config/types.js';
import { createHttpServer, shutdownHttpServer } from '../../src/server/http.js';
import { ALL_TOOL_NAMES } from '../../src/tools/register-all.js';
import { D4SignReadService } from '../../src/services/d4sign-read-service.js';
import { D4SignWriteService } from '../../src/services/d4sign-write-service.js';
import { D4SignFileService } from '../../src/services/d4sign-file-service.js';
import { ConfirmationWorkflow } from '../../src/server/confirmation-workflow.js';
import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import type { D4SignCredentials, WritableCredentialProvider } from '../../src/auth/credential-provider.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { InMemoryUploadStore } from '../../src/infra/upload-store.js';
import { InMemoryRateLimiter } from '../../src/infra/rate-limiter.js';

const bearerToken = 'bearer-token-de-teste-com-mais-de-32-caracteres';
const logger = pino({ enabled: false });

const config: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  host: '127.0.0.1',
  allowedHosts: ['127.0.0.1'],
  allowedOriginHosts: ['localhost'],
  authMode: 'static',
  mcpBearerToken: bearerToken,
  mcpMaxBodyBytes: 100_000,
  mcpUploadTtlMs: 600_000,
  mcpRequestsPerMinute: 120,
  mcpUploadsPerMinute: 20,
  mcpAnonymousRequestsPerMinute: 1_000,
  mcpShutdownGraceMs: 2_000,
  credentialBackend: 'environment',
  credentialScope: 'principal',
  credentialCacheTtlMs: 30_000,
  stateBackend: 'memory',
  uploadBackend: 'memory',
  d4sign: {
    environment: 'sandbox',
    tokenApi: 'token-de-teste',
    requestsPerHour: 10,
    timeoutMs: 1_000,
    maxResponseBytes: 50_000,
    maxUploadBytes: 10_000_000,
  },
  logLevel: 'silent',
};

function dependencies() {
  const credentialProvider = new MockCredentialProvider({
    tokenApi: 'token-de-teste',
    environment: 'sandbox',
  });
  const cache = new InMemoryPrivateCache();
  const quotaManager = new InMemoryQuotaManager(10);
  const uploadStore = new InMemoryUploadStore(600_000);
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('[]', { status: 200 }));
  const readService = new D4SignReadService({
    credentialProvider,
    cache,
    quotaManager,
    logger,
    timeoutMs: 1_000,
    maxResponseBytes: 50_000,
    fetchImpl,
  });
  const writeService = new D4SignWriteService({
    credentialProvider,
    cache,
    quotaManager,
    logger,
    timeoutMs: 1_000,
    maxResponseBytes: 50_000,
    fetchImpl,
  });
  const fileService = new D4SignFileService({
    credentialProvider,
    cache,
    quotaManager,
    uploadStore,
    logger,
    timeoutMs: 1_000,
    maxResponseBytes: 50_000,
    maxUploadBytes: 10_000_000,
    fetchImpl,
  });
  return {
    transport: 'http' as const,
    readService,
    writeService,
    fileService,
    uploadStore,
    confirmationWorkflow: new ConfirmationWorkflow({
      key: 'test-request-state-key-with-at-least-32-bytes',
      transport: 'http',
    }),
    readiness: () => Promise.resolve({ ready: true, checks: { state: 'ok' as const } }),
    credentialProvider,
    rateLimiter: new InMemoryRateLimiter(),
    logger,
    close: () => Promise.resolve(),
  };
}

describe('entrada HTTP', () => {
  it('serve health e MCP moderno autenticado pelo adaptador Node', async () => {
    const server = createHttpServer(config, dependencies());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;

    try {
      const health = await fetch(`${origin}/health/live`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ status: 'ok' });

      const readiness = await fetch(`${origin}/health/ready`, {
        headers: { Host: 'internal-probe.container-apps.local' },
      });
      expect(readiness.status).toBe(200);
      await expect(readiness.json()).resolves.toMatchObject({ status: 'ready', checks: { state: 'ok' } });

      const metadata = await fetch(`${origin}/.well-known/oauth-protected-resource`, {
        headers: { 'X-Request-Id': 'integration-request-1' },
      });
      expect(metadata.status).toBe(200);
      expect(metadata.headers.get('x-request-id')).toBe('integration-request-1');
      await expect(metadata.json()).resolves.toMatchObject({ resource: `${origin}/mcp` });

      const unauthorized = await fetch(`${origin}/mcp`, { method: 'POST', body: '{}' });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get('www-authenticate')).toContain('resource_metadata=');

      const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        authProvider: { token: () => Promise.resolve(bearerToken) },
      });
      const client = new Client(
        { name: 'node-http-test', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      );
      await client.connect(transport);
      try {
        const listed = await client.listTools();
        expect(listed.tools.map((tool) => tool.name)).toEqual(ALL_TOOL_NAMES);
      } finally {
        await client.close();
      }
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('ingere upload autenticado, valida conteúdo e devolve handle temporário', async () => {
    const server = createHttpServer(config, dependencies());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const pdf = Buffer.from('%PDF-1.7\nconteudo de teste', 'ascii');

    try {
      const unauthorized = await fetch(`${origin}/uploads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'contrato.pdf' },
        body: pdf,
      });
      expect(unauthorized.status).toBe(401);

      const invalid = await fetch(`${origin}/uploads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'image/png',
          'X-File-Name': 'imagem.png',
        },
        body: pdf,
      });
      expect(invalid.status).toBe(400);

      const uploaded = await fetch(`${origin}/uploads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/pdf',
          'X-File-Name': 'contrato.pdf',
        },
        body: pdf,
      });
      expect(uploaded.status).toBe(201);
      expect(uploaded.headers.get('cache-control')).toBe('no-store');
      const receipt: unknown = await uploaded.json();
      expect(receipt).toMatchObject({
        fileName: 'contrato.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdf.byteLength,
      });
      expect((receipt as Record<string, unknown>).uploadHandle).toMatch(/^[a-f0-9-]{36}$/u);
      expect((receipt as Record<string, unknown>).sha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error !== undefined) reject(error);
        else resolve();
      }));
    }
  });

  it('devolve 503 em /health/ready quando uma dependência está indisponível', async () => {
    // Readiness que responde 200 incondicionalmente impede o circuit breaker do
    // ECS de detectar uma task degradada e faz o ALB seguir roteando tráfego.
    const server = createHttpServer(config, {
      ...dependencies(),
      readiness: () => Promise.resolve({ ready: false, checks: { state: 'unavailable' as const } }),
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const live = await fetch(`${origin}/health/live`);
      expect(live.status).toBe(200);

      const ready = await fetch(`${origin}/health/ready`);
      expect(ready.status).toBe(503);
      await expect(ready.json()).resolves.toMatchObject({
        status: 'degraded',
        checks: { state: 'unavailable' },
      });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('aplica limite por origem antes de qualquer validação de token', async () => {
    const server = createHttpServer(
      { ...config, mcpAnonymousRequestsPerMinute: 2 },
      dependencies(),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(`${origin}/mcp`, {
          method: 'POST',
          headers: { Authorization: 'Bearer token-invalido' },
          body: '{}',
        });
        statuses.push(response.status);
        if (response.status === 429) {
          expect(response.headers.get('retry-after')).not.toBeNull();
        }
      }
      // As duas primeiras chegam à autenticação (401); as demais são barradas
      // antes, sem gastar CPU de verificação de assinatura.
      expect(statuses.slice(0, 2)).toEqual([401, 401]);
      expect(statuses.slice(2)).toEqual([429, 429]);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('encerra com prazo mesmo com conexão keep-alive aberta', async () => {
    const deps = dependencies();
    const closed = vi.fn(() => Promise.resolve());
    const server = createHttpServer(config, { ...deps, close: closed });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(`${origin}/health/live`, { agent }, (response) => {
        response.resume();
        response.once('end', () => resolve());
      });
      request.once('error', reject);
      request.end();
    });

    // Sem prazo de drenagem, server.close() poderia nunca completar.
    await shutdownHttpServer(server, { ...deps, close: closed }, 1_000);
    expect(closed).toHaveBeenCalledTimes(1);
    agent.destroy();
  });

  it('cadastra e revoga credenciais sem devolvê-las na resposta', async () => {
    let stored: D4SignCredentials | undefined;
    const credentialStore: WritableCredentialProvider = {
      getCredentials: () => stored === undefined
        ? Promise.reject(new Error('Credenciais ausentes'))
        : Promise.resolve(stored),
      setCredentials: (_context, credentials) => {
        stored = credentials;
        return Promise.resolve();
      },
      deleteCredentials: () => {
        stored = undefined;
        return Promise.resolve();
      },
    };
    const server = createHttpServer(config, { ...dependencies(), credentialStore });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;

    try {
      const saved = await fetch(`${origin}/credentials/d4sign`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tokenApi: 'segredo-que-nao-deve-voltar',
          cryptKey: 'chave-criptografica',
          environment: 'production',
          requestsPerHour: 1_000,
        }),
      });
      expect(saved.status).toBe(204);
      expect(saved.headers.get('content-type')).toBeNull();
      await expect(saved.text()).resolves.toBe('');
      expect(stored).toEqual({
        tokenApi: 'segredo-que-nao-deve-voltar',
        cryptKey: 'chave-criptografica',
        environment: 'production',
        requestsPerHour: 1_000,
      });

      const deleted = await fetch(`${origin}/credentials/d4sign`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      expect(deleted.status).toBe(204);
      expect(stored).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error !== undefined) reject(error);
        else resolve();
      }));
    }
  });
});
