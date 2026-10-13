import { z } from 'zod/v4';

import { SCOPES } from '../auth/scopes.js';
import type { AppConfig } from '../config/types.js';
import type { AppLogger } from '../infra/logger.js';

const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:', 'o endpoint deve usar https');

const UpstreamMetadataSchema = z
  .object({
    authorization_endpoint: httpsUrl,
    token_endpoint: httpsUrl,
    revocation_endpoint: httpsUrl.optional(),
  })
  .loose();

/**
 * Scopes que uma ferramenta de IA nunca deve conseguir obter.
 *
 * Administrar usuários da D4Sign e gerenciar credenciais não são operações de
 * conversa. Além do princípio de menor privilégio, anunciar um scope que o
 * client OAuth não concede faz o host pedir "todos os anunciados" e receber
 * `invalid_scope` do provedor, quebrando o login inteiro.
 */
const NEVER_ADVERTISED: readonly string[] = [SCOPES.usersAdmin, SCOPES.credentialsWrite];

export function advertisedScopes(scopePrefix: string): string[] {
  const prefix = scopePrefix.length === 0 ? '' : `${scopePrefix}/`;
  return [...new Set(Object.values(SCOPES))]
    .filter((scope) => !NEVER_ADVERTISED.includes(scope))
    .map((scope) => `${prefix}${scope}`);
}

export function isMetadataFacadeEnabled(config: AppConfig): boolean {
  return config.oidc?.metadataFacade === true && config.publicBaseUrl !== undefined;
}

export class AuthorizationServerUnavailableError extends Error {
  constructor() {
    super('A metadata do authorization server está indisponível.');
    this.name = 'AuthorizationServerUnavailableError';
  }
}

export interface AuthorizationServerMetadataOptions {
  /** Identificador publicado: a origem pública deste servidor MCP. */
  issuer: string;
  /** Emissor real dos tokens (por exemplo, o user pool do Cognito). */
  upstreamIssuer: string;
  scopePrefix: string;
  logger: AppLogger;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

interface CachedDocument {
  document: Record<string, unknown>;
  fetchedAt: number;
}

/**
 * Publica a metadata de authorization server que as ferramentas de IA exigem.
 *
 * Provedores como o Amazon Cognito executam Authorization Code com PKCE, mas
 * não declaram isso no documento de descoberta, e a especificação do MCP manda
 * o cliente recusar um servidor que não declara. Esta camada completa o que
 * falta e aponta os endpoints para o provedor real: a emissão e a validação
 * dos tokens continuam sendo do provedor.
 */
export class AuthorizationServerMetadata {
  private cached: CachedDocument | undefined;
  private inFlight: Promise<Record<string, unknown>> | undefined;

  constructor(private readonly options: AuthorizationServerMetadataOptions) {}

  async get(): Promise<Record<string, unknown>> {
    const now = (this.options.now ?? Date.now)();
    if (this.cached !== undefined && now - this.cached.fetchedAt < (this.options.ttlMs ?? 3_600_000)) {
      return this.cached.document;
    }
    this.inFlight ??= this.refresh().finally(() => {
      this.inFlight = undefined;
    });
    try {
      return await this.inFlight;
    } catch (error) {
      if (this.cached !== undefined) {
        // Melhor servir a última metadata conhecida do que derrubar o login.
        this.options.logger.warn({ err: error }, 'Falha ao renovar a metadata do authorization server; usando a anterior');
        return this.cached.document;
      }
      this.options.logger.error({ err: error }, 'Metadata do authorization server indisponível');
      throw new AuthorizationServerUnavailableError();
    }
  }

  private async refresh(): Promise<Record<string, unknown>> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(`${this.options.upstreamIssuer}/.well-known/openid-configuration`, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
    });
    if (!response.ok) throw new Error(`O provedor respondeu ${String(response.status)}.`);
    const text = await response.text();
    if (text.length > 65_536) throw new Error('A metadata do provedor excede o limite de tamanho.');
    const upstream = UpstreamMetadataSchema.parse(JSON.parse(text));
    const document = this.compose(upstream);
    this.cached = { document, fetchedAt: (this.options.now ?? Date.now)() };
    return document;
  }

  private compose(upstream: z.infer<typeof UpstreamMetadataSchema>): Record<string, unknown> {
    return {
      issuer: this.options.issuer,
      authorization_endpoint: upstream.authorization_endpoint,
      token_endpoint: upstream.token_endpoint,
      ...(upstream.revocation_endpoint === undefined ? {} : { revocation_endpoint: upstream.revocation_endpoint }),
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: advertisedScopes(this.options.scopePrefix),
    };
  }
}
