import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/env.js';
import { createHttpServer } from '../../src/server/http.js';
import { OIDC_ISSUER, PUBLIC_BASE_URL, buildDependencies, oidcConfig } from '../support/http-fixtures.js';

const HOSTED_UI = 'https://exemplo.auth.sa-east-1.amazoncognito.com';
const cognitoDiscovery = {
  issuer: OIDC_ISSUER,
  authorization_endpoint: `${HOSTED_UI}/oauth2/authorize`,
  token_endpoint: `${HOSTED_UI}/oauth2/token`,
};

async function withServer<T>(
  config: ReturnType<typeof oidcConfig>,
  fetchImpl: typeof fetch,
  run: (origin: string) => Promise<T>,
): Promise<T> {
  const server = createHttpServer(config, buildDependencies(), { fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

const upstreamOk: typeof fetch = () => Promise.resolve(new Response(JSON.stringify(cognitoDiscovery), { status: 200 }));

describe('descoberta OAuth do servidor MCP', () => {
  it('com a camada ativa, o recurso aponta para esta origem e a metadata declara PKCE', async () => {
    await withServer(oidcConfig({ metadataFacade: true }), upstreamOk, async (origin) => {
      const resource = await (await fetch(`${origin}/.well-known/oauth-protected-resource`)).json() as Record<string, unknown>;
      expect(resource.resource).toBe(`${PUBLIC_BASE_URL}/mcp`);
      expect(resource.authorization_servers).toEqual([PUBLIC_BASE_URL]);
      expect(resource.scopes_supported).not.toContain('d4sign-mcp/d4sign:users:admin');

      const response = await fetch(`${origin}/.well-known/oauth-authorization-server`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      const metadata = await response.json() as Record<string, unknown>;
      expect(metadata.issuer).toBe(PUBLIC_BASE_URL);
      expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
      expect(metadata.authorization_endpoint).toBe(cognitoDiscovery.authorization_endpoint);
    });
  });

  it('o issuer anunciado pelo recurso é exatamente o issuer da metadata', async () => {
    await withServer(oidcConfig({ metadataFacade: true }), upstreamOk, async (origin) => {
      const resource = await (await fetch(`${origin}/.well-known/oauth-protected-resource`)).json() as {
        authorization_servers: string[];
      };
      const metadata = await (await fetch(`${origin}/.well-known/oauth-authorization-server`)).json() as { issuer: string };
      // RFC 8414 §3.3: divergência faz o cliente descartar a metadata.
      expect(metadata.issuer).toBe(resource.authorization_servers[0]);
    });
  });

  it('com a camada desligada, mantém o comportamento anterior', async () => {
    await withServer(oidcConfig(), upstreamOk, async (origin) => {
      const resource = await (await fetch(`${origin}/.well-known/oauth-protected-resource`)).json() as Record<string, unknown>;
      expect(resource.authorization_servers).toEqual([OIDC_ISSUER]);
      expect(resource.scopes_supported).toContain('d4sign-mcp/d4sign:users:admin');
      expect((await fetch(`${origin}/.well-known/oauth-authorization-server`)).status).toBe(404);
    });
  });

  it('devolve 503 com Retry-After quando o provedor está fora e não há metadata anterior', async () => {
    const fora: typeof fetch = () => Promise.resolve(new Response('erro', { status: 503 }));
    await withServer(oidcConfig({ metadataFacade: true }), fora, async (origin) => {
      const response = await fetch(`${origin}/.well-known/oauth-authorization-server`);
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('30');
    });
  });

  it('continua exigindo token em /mcp e apontando para a metadata do recurso', async () => {
    await withServer(oidcConfig({ metadataFacade: true }), upstreamOk, async (origin) => {
      const response = await fetch(`${origin}/mcp`, { method: 'POST', body: '{}' });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    });
  });
});

describe('configuração da camada', () => {
  const base = {
    D4SIGN_TOKEN_API: 'token',
    D4SIGN_REQUESTS_PER_HOUR: '100',
    MCP_AUTH_MODE: 'oidc',
    OIDC_ISSUER: OIDC_ISSUER,
    OIDC_ALLOWED_CLIENT_IDS: 'client-publico',
    MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
  };

  it('fica desligada por padrão', () => {
    expect(loadConfig(base).oidc?.metadataFacade).toBeUndefined();
  });

  it('liga com OIDC_METADATA_FACADE=true', () => {
    expect(loadConfig({ ...base, OIDC_METADATA_FACADE: 'true' }).oidc?.metadataFacade).toBe(true);
  });

  it('exige OIDC e URL pública quando ligada', () => {
    const semUrl: Record<string, string> = { ...base };
    delete semUrl.MCP_PUBLIC_BASE_URL;
    expect(() => loadConfig({ ...semUrl, OIDC_METADATA_FACADE: 'true' })).toThrow('OIDC_METADATA_FACADE');
    expect(() => loadConfig({
      D4SIGN_TOKEN_API: 'token',
      D4SIGN_REQUESTS_PER_HOUR: '100',
      MCP_PUBLIC_BASE_URL: PUBLIC_BASE_URL,
      OIDC_METADATA_FACADE: 'true',
    })).toThrow('OIDC_METADATA_FACADE');
  });
});
