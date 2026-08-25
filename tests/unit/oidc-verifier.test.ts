import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyObject } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AuthenticationError,
  OidcAccessTokenVerifier,
  createAccessTokenVerifier,
  tokenScopes,
} from '../../src/auth/access-token-verifier.js';
import type { AppConfig } from '../../src/config/types.js';

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_exemplo';
const CLIENT_ID = '5abcdefghijklmnopqrstuvwxy';
const RESOURCE = 'https://mcp.exemplo.com/mcp';
const SCOPE_PREFIX = 'd4sign-mcp';

let privateKey: KeyObject | CryptoKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', kid: 'test-key' };
});

/** Instala um JWKS local, para que a suíte nunca dependa de rede. */
function verifier(oidc: NonNullable<AppConfig['oidc']>): OidcAccessTokenVerifier {
  const jwks = { keys: [publicJwk] };
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(jwks), {
    status: 200,
    headers: { 'Content-Type': 'application/jwk-set+json' },
  })));
  return new OidcAccessTokenVerifier(oidc);
}

async function sign(payload: Record<string, unknown>, options: { audience?: string } = {}): Promise<string> {
  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('1h');
  if (options.audience !== undefined) jwt = jwt.setAudience(options.audience);
  return jwt.sign(privateKey);
}

/** Formato real de um access token de user pool do Amazon Cognito: sem `aud`. */
function cognitoAccessToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: '11111111-2222-3333-4444-555555555555',
    token_use: 'access',
    scope: `openid email ${SCOPE_PREFIX}/d4sign:documents:read ${SCOPE_PREFIX}/d4sign:vaults:read`,
    client_id: CLIENT_ID,
    username: 'usuario@exemplo.com',
    'cognito:groups': ['d4sign-readers'],
    ...overrides,
  };
}

const cognitoConfig: NonNullable<AppConfig['oidc']> = {
  issuer: ISSUER,
  allowedClientIds: [CLIENT_ID],
  jwksUrl: `${ISSUER}/.well-known/jwks.json`,
  scopePrefix: SCOPE_PREFIX,
};

const rfc8707Config: NonNullable<AppConfig['oidc']> = {
  issuer: ISSUER,
  audience: RESOURCE,
  jwksUrl: `${ISSUER}/.well-known/jwks.json`,
  scopePrefix: SCOPE_PREFIX,
};

describe('OidcAccessTokenVerifier — Amazon Cognito (sem claim aud)', () => {
  it('aceita o access token real do Cognito e extrai principal e scopes internos', async () => {
    const token = await sign(cognitoAccessToken());
    const auth = await verifier(cognitoConfig).verify(`Bearer ${token}`);

    expect(auth.clientId).toBe(CLIENT_ID);
    expect(auth.extra?.principalId).toBe('11111111-2222-3333-4444-555555555555');
    expect(auth.extra?.tenantId).toBe(ISSUER);
    expect(auth.scopes).toEqual(['d4sign:documents:read', 'd4sign:vaults:read']);
  });

  it('rejeita token de client ID não autorizado', async () => {
    const token = await sign(cognitoAccessToken({ client_id: 'outro-app-client' }));
    await expect(verifier(cognitoConfig).verify(`Bearer ${token}`)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('sem audience configurada, exige token_use=access explicitamente', async () => {
    // Sem `aud`, `token_use` é a única prova de que não é um ID token.
    const semTokenUse = await sign(cognitoAccessToken({ token_use: undefined }));
    await expect(verifier(cognitoConfig).verify(`Bearer ${semTokenUse}`)).rejects.toBeInstanceOf(AuthenticationError);

    const idToken = await sign(cognitoAccessToken({ token_use: 'id' }));
    await expect(verifier(cognitoConfig).verify(`Bearer ${idToken}`)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('exige audience ou allowedClientIds na construção', () => {
    expect(() => new OidcAccessTokenVerifier({
      issuer: ISSUER,
      jwksUrl: `${ISSUER}/.well-known/jwks.json`,
      scopePrefix: SCOPE_PREFIX,
    })).toThrow('audience ou allowedClientIds');
  });
});

describe('OidcAccessTokenVerifier — IdP com RFC 8707 (com claim aud)', () => {
  it('aceita token com aud igual ao recurso', async () => {
    const token = await sign(cognitoAccessToken(), { audience: RESOURCE });
    const auth = await verifier(rfc8707Config).verify(`Bearer ${token}`);
    expect(auth.extra?.principalId).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('rejeita token destinado a outro recurso', async () => {
    const token = await sign(cognitoAccessToken(), { audience: 'https://outro.exemplo.com/mcp' });
    await expect(verifier(rfc8707Config).verify(`Bearer ${token}`)).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe('OidcAccessTokenVerifier — rejeições gerais', () => {
  it('rejeita issuer divergente, expirado e assinatura desconhecida', async () => {
    const outroIssuer = await new SignJWT(cognitoAccessToken())
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://idp.malicioso.example')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    await expect(verifier(cognitoConfig).verify(`Bearer ${outroIssuer}`)).rejects.toBeInstanceOf(AuthenticationError);

    const expirado = await new SignJWT(cognitoAccessToken())
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setIssuedAt(Math.floor(Date.now() / 1_000) - 7_200)
      .setExpirationTime(Math.floor(Date.now() / 1_000) - 3_600)
      .sign(privateKey);
    await expect(verifier(cognitoConfig).verify(`Bearer ${expirado}`)).rejects.toBeInstanceOf(AuthenticationError);

    const outraChave = await generateKeyPair('RS256', { extractable: true });
    const assinaturaEstranha = await new SignJWT(cognitoAccessToken())
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(outraChave.privateKey);
    await expect(verifier(cognitoConfig).verify(`Bearer ${assinaturaEstranha}`)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejeita header ausente ou malformado', async () => {
    const target = verifier(cognitoConfig);
    await expect(target.verify(undefined)).rejects.toMatchObject({ reason: 'missing_token' });
    await expect(target.verify('Basic abc')).rejects.toMatchObject({ reason: 'missing_token' });
  });
});

describe('tokenScopes', () => {
  it('aceita somente scopes prefixados quando há resource server', () => {
    const scopes = tokenScopes(
      {
        scope: [
          `${SCOPE_PREFIX}/d4sign:documents:read`,
          // Sem prefixo: não passou pelo resource server deste recurso e não
          // pode ser promovido a permissão interna.
          'd4sign:users:admin',
          'openid',
        ].join(' '),
      },
      SCOPE_PREFIX,
    );
    expect(scopes).toEqual(['d4sign:documents:read']);
    expect(scopes).not.toContain('d4sign:users:admin');
  });

  it('ignora a claim roles, que não é escopo OAuth deste recurso', () => {
    const scopes = tokenScopes(
      { scope: `${SCOPE_PREFIX}/d4sign:documents:read`, roles: ['d4sign:users:admin'] },
      SCOPE_PREFIX,
    );
    expect(scopes).toEqual(['d4sign:documents:read']);
  });

  it('sem prefixo configurado, usa scope e scp como vêm', () => {
    expect(tokenScopes({ scp: 'd4sign:documents:read', scope: 'd4sign:tags:read' }, ''))
      .toEqual(['d4sign:documents:read', 'd4sign:tags:read']);
  });
});

describe('createAccessTokenVerifier', () => {
  it('exige bearer de 32+ caracteres no modo static', () => {
    const base = { authMode: 'static' } as unknown as AppConfig;
    expect(() => createAccessTokenVerifier(base)).toThrow('MCP_BEARER_TOKEN');
    expect(() => createAccessTokenVerifier({ ...base, mcpBearerToken: 'curto' })).toThrow('MCP_BEARER_TOKEN');
  });

  it('concede todos os scopes no modo static e valida o token em tempo constante', async () => {
    const token = 'bearer-de-desenvolvimento-com-mais-de-32-caracteres';
    const target = createAccessTokenVerifier({ authMode: 'static', mcpBearerToken: token } as unknown as AppConfig);
    const auth = await target.verify(`Bearer ${token}`);
    expect(auth.scopes).toContain('d4sign:users:admin');
    await expect(target.verify('Bearer token-errado')).rejects.toMatchObject({ reason: 'invalid_token' });
  });
});
