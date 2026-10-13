import { describe, expect, it, vi } from 'vitest';

import {
  AuthorizationServerMetadata,
  AuthorizationServerUnavailableError,
  advertisedScopes,
  isMetadataFacadeEnabled,
} from '../../src/server/authorization-server-metadata.js';
import { PUBLIC_BASE_URL, OIDC_ISSUER, logger, oidcConfig } from '../support/http-fixtures.js';

const HOSTED_UI = 'https://exemplo.auth.sa-east-1.amazoncognito.com';

/** O que o Cognito publica de fato: sem PKCE, sem registro dinâmico. */
const cognitoDiscovery = {
  issuer: OIDC_ISSUER,
  authorization_endpoint: `${HOSTED_UI}/oauth2/authorize`,
  token_endpoint: `${HOSTED_UI}/oauth2/token`,
  jwks_uri: `${OIDC_ISSUER}/.well-known/jwks.json`,
  scopes_supported: ['openid', 'email', 'phone', 'profile'],
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
};

function respond(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

function build(fetchImpl: typeof fetch, options: { ttlMs?: number; now?: () => number } = {}) {
  return new AuthorizationServerMetadata({
    issuer: PUBLIC_BASE_URL,
    upstreamIssuer: OIDC_ISSUER,
    scopePrefix: 'd4sign-mcp',
    logger,
    fetchImpl,
    ...options,
  });
}

describe('metadata do authorization server', () => {
  it('publica o que a especificação do MCP exige de um authorization server', async () => {
    const metadata = await build(() => respond(cognitoDiscovery)).get();

    // RFC 8414 §3.3: o issuer publicado é o identificador usado para montar a URL.
    expect(metadata.issuer).toBe(PUBLIC_BASE_URL);
    // MCP 2025-11-25: sem este campo o cliente DEVE recusar o servidor.
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
    expect(metadata.response_types_supported).toEqual(['code']);
    expect(metadata.token_endpoint_auth_methods_supported).toContain('none');
    // Os endpoints continuam sendo do provedor: ele emite e valida os tokens.
    expect(metadata.authorization_endpoint).toBe(`${HOSTED_UI}/oauth2/authorize`);
    expect(metadata.token_endpoint).toBe(`${HOSTED_UI}/oauth2/token`);
  });

  it('não promete registro dinâmico que o provedor não oferece', async () => {
    const metadata = await build(() => respond(cognitoDiscovery)).get();
    expect(metadata).not.toHaveProperty('registration_endpoint');
  });

  it('anuncia somente scopes que o client público consegue obter', async () => {
    const metadata = await build(() => respond(cognitoDiscovery)).get();
    const scopes = metadata.scopes_supported as string[];

    expect(scopes.length).toBeGreaterThan(10);
    expect(scopes.every((scope) => scope.startsWith('d4sign-mcp/'))).toBe(true);
    // Administrar usuários e credenciais não é operação de conversa, e anunciar
    // um scope negado pelo client faria o host receber invalid_scope no login.
    expect(scopes).not.toContain('d4sign-mcp/d4sign:users:admin');
    expect(scopes).not.toContain('d4sign-mcp/d4sign:credentials:write');
    expect(scopes).not.toContain('offline_access');
    expect(scopes).toContain('d4sign-mcp/d4sign:documents:read');
  });

  it('respeita ausência de prefixo de resource server', () => {
    expect(advertisedScopes('')).toContain('d4sign:documents:read');
    expect(advertisedScopes('')).not.toContain('d4sign:users:admin');
  });

  it('consulta o provedor uma única vez dentro do TTL e de novo depois dele', async () => {
    let agora = 1_000;
    const fetchImpl = vi.fn<typeof fetch>(() => respond(cognitoDiscovery));
    const metadata = build(fetchImpl, { ttlMs: 60_000, now: () => agora });

    await metadata.get();
    await metadata.get();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    agora += 61_000;
    await metadata.get();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('deduplica renovações simultâneas', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => respond(cognitoDiscovery));
    const metadata = build(fetchImpl);
    await Promise.all([metadata.get(), metadata.get(), metadata.get()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serve a última metadata conhecida quando o provedor falha na renovação', async () => {
    let agora = 1_000;
    let derrubado = false;
    const fetchImpl: typeof fetch = () => (derrubado ? respond('erro', 503) : respond(cognitoDiscovery));
    const metadata = build(fetchImpl, { ttlMs: 10_000, now: () => agora });

    const original = await metadata.get();
    derrubado = true;
    agora += 20_000;
    // Derrubar o login por uma oscilação do provedor seria pior que servir a anterior.
    await expect(metadata.get()).resolves.toEqual(original);
  });

  it('falha de forma explícita quando não há metadata e o provedor está fora', async () => {
    const metadata = build(() => respond('erro', 503));
    await expect(metadata.get()).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
  });

  it('rejeita endpoint do provedor que não usa https', async () => {
    const inseguro = { ...cognitoDiscovery, token_endpoint: 'http://exemplo.test/oauth2/token' };
    await expect(build(() => respond(inseguro)).get()).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
  });

  it('rejeita metadata sem os endpoints obrigatórios', async () => {
    await expect(build(() => respond({ issuer: OIDC_ISSUER })).get()).rejects.toBeInstanceOf(
      AuthorizationServerUnavailableError,
    );
  });

  it('rejeita resposta absurdamente grande do provedor', async () => {
    const enorme = JSON.stringify({ ...cognitoDiscovery, lixo: 'x'.repeat(70_000) });
    await expect(build(() => respond(enorme)).get()).rejects.toBeInstanceOf(AuthorizationServerUnavailableError);
  });

  it('não segue redirects ao consultar o provedor', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => respond(cognitoDiscovery));
    await build(fetchImpl).get();
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error');
  });
});

describe('ativação da camada', () => {
  it('só ativa com a flag e com a URL pública definidas', () => {
    expect(isMetadataFacadeEnabled(oidcConfig())).toBe(false);
    expect(isMetadataFacadeEnabled(oidcConfig({ metadataFacade: true }))).toBe(true);
    const semUrl = oidcConfig({ metadataFacade: true });
    delete semUrl.publicBaseUrl;
    expect(isMetadataFacadeEnabled(semUrl)).toBe(false);
  });
});
