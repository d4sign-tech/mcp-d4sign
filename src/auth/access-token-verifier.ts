import { timingSafeEqual } from 'node:crypto';

import type { AuthInfo } from '@modelcontextprotocol/server';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose';

import type { AppConfig } from '../config/types.js';
import { D4SIGN_SCOPES } from './scopes.js';

export class AuthenticationError extends Error {
  constructor(readonly reason: 'missing_token' | 'invalid_token') {
    super(reason);
    this.name = 'AuthenticationError';
  }
}

export interface AccessTokenVerifier {
  verify(authorizationHeader: string | undefined): Promise<AuthInfo>;
}

function bearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/iu.exec(header ?? '');
  if (match?.[1] === undefined) throw new AuthenticationError('missing_token');
  return match[1];
}

function secureEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export class StaticAccessTokenVerifier implements AccessTokenVerifier {
  constructor(private readonly expectedToken: string) {}

  // `async` de propósito: uma implementação tipada como Promise precisa
  // rejeitar, não lançar de forma sincrona, para que qualquer chamador possa
  // tratar a falha de um único jeito.
  async verify(authorizationHeader: string | undefined): Promise<AuthInfo> {
    const token = bearerToken(authorizationHeader);
    if (!secureEquals(token, this.expectedToken)) throw new AuthenticationError('invalid_token');
    return Promise.resolve({
      token,
      clientId: 'local-development-client',
      scopes: D4SIGN_SCOPES,
      expiresAt: Math.floor(Date.now() / 1_000) + 60,
      extra: {
        principalId: 'local-development-principal',
        tenantId: 'local-single-tenant',
      },
    });
  }
}

function stringClaim(payload: JWTPayload, names: string[]): string | undefined {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Extrai os scopes internos do access token.
 *
 * Quando há prefixo de resource server configurado, somente scopes prefixados
 * são aceitos: um scope sem prefixo não passou pelo resource server deste
 * recurso e não pode ser promovido a permissão interna. Claims de papel
 * (`roles`) não são consideradas — elas não são escopos OAuth deste recurso e
 * aceitá-las contornaria a supressão feita no emissor.
 */
export function tokenScopes(payload: JWTPayload, prefix: string): string[] {
  const delegated = typeof payload.scp === 'string' ? payload.scp.split(/\s+/u) : [];
  const oauthScopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/u) : [];
  const declared = [...delegated, ...oauthScopes].filter(Boolean);
  if (prefix.length === 0) return [...new Set(declared)];
  const providerPrefix = `${prefix}/`;
  return [
    ...new Set(
      declared
        .filter((scope) => scope.startsWith(providerPrefix))
        .map((scope) => scope.slice(providerPrefix.length))
        .filter(Boolean),
    ),
  ];
}

export class OidcAccessTokenVerifier implements AccessTokenVerifier {
  private readonly jwks;

  constructor(private readonly config: NonNullable<AppConfig['oidc']>) {
    if (config.audience === undefined && (config.allowedClientIds ?? []).length === 0) {
      throw new Error('OIDC exige audience ou allowedClientIds para vincular o token a este recurso.');
    }
    this.jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
    });
  }

  async verify(authorizationHeader: string | undefined): Promise<AuthInfo> {
    const token = bearerToken(authorizationHeader);
    try {
      const options: JWTVerifyOptions = {
        issuer: this.config.issuer,
        clockTolerance: 30,
        ...(this.config.audience === undefined ? {} : { audience: this.config.audience }),
      };
      const { payload } = await jwtVerify(token, this.jwks, options);

      // Um ID token nunca autoriza uma chamada de recurso.
      if (payload.token_use !== undefined && payload.token_use !== 'access') {
        throw new AuthenticationError('invalid_token');
      }

      const principalId = stringClaim(payload, ['sub', 'oid']);
      const clientId = stringClaim(payload, ['client_id', 'azp', 'appid']) ?? principalId;

      // Sem `aud`, o único vínculo com este recurso é o client ID autorizado.
      // Nesse caminho `token_use=access` passa a ser obrigatório, e não opcional,
      // para que um ID token sem `aud` correspondente jamais seja aceito.
      const allowedClientIds = this.config.allowedClientIds ?? [];
      if (allowedClientIds.length > 0) {
        if (clientId === undefined || !allowedClientIds.includes(clientId)) {
          throw new AuthenticationError('invalid_token');
        }
      }
      if (this.config.audience === undefined && payload.token_use !== 'access') {
        throw new AuthenticationError('invalid_token');
      }

      const tenantId = this.config.tenantClaim === undefined
        ? this.config.issuer
        : stringClaim(payload, [this.config.tenantClaim]);
      if (tenantId === undefined || principalId === undefined || clientId === undefined) {
        throw new AuthenticationError('invalid_token');
      }
      return {
        token,
        clientId,
        scopes: tokenScopes(payload, this.config.scopePrefix),
        ...(payload.exp === undefined ? {} : { expiresAt: payload.exp }),
        extra: { principalId, tenantId },
      };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError('invalid_token');
    }
  }
}

export function createAccessTokenVerifier(config: AppConfig): AccessTokenVerifier {
  if (config.authMode === 'oidc') {
    if (config.oidc === undefined) throw new Error('Configuração OIDC ausente.');
    return new OidcAccessTokenVerifier(config.oidc);
  }
  if (config.mcpBearerToken === undefined || config.mcpBearerToken.length < 32) {
    throw new Error('MCP_BEARER_TOKEN com pelo menos 32 caracteres é obrigatório no modo static.');
  }
  return new StaticAccessTokenVerifier(config.mcpBearerToken);
}
