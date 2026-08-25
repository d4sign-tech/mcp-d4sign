import { z } from 'zod/v4';

import type { AppConfig } from './types.js';

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const s3BucketName = z.string().trim().min(3).max(63).regex(
  /^(?!\d+\.\d+\.\d+\.\d+$)(?!.*\.\.)(?!.*\.-)(?!.*-\.)[a-z0-9][a-z0-9.-]*[a-z0-9]$/u,
  'AWS_S3_BUCKET deve ser um nome de bucket S3 válido',
);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    MCP_ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,[::1]'),
    MCP_ALLOWED_ORIGINS: z.string().default('http://localhost:6274'),
    MCP_PUBLIC_BASE_URL: optionalNonEmptyString,
    MCP_AUTH_MODE: z.enum(['static', 'oidc']).default('static'),
    MCP_BEARER_TOKEN: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().min(32, 'MCP_BEARER_TOKEN deve ter pelo menos 32 caracteres').optional(),
    ),
    OIDC_ISSUER: optionalNonEmptyString,
    OIDC_AUDIENCE: optionalNonEmptyString,
    OIDC_ALLOWED_CLIENT_IDS: z.string().trim().default(''),
    OIDC_JWKS_URL: optionalNonEmptyString,
    OIDC_SCOPE_PREFIX: z.string().trim().default(''),
    OIDC_TENANT_CLAIM: optionalNonEmptyString,
    MCP_REQUEST_STATE_KEY: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().min(32, 'MCP_REQUEST_STATE_KEY deve ter pelo menos 32 bytes').optional(),
    ),
    // Precisa acomodar o teto de base64 inline das tools binárias.
    MCP_MAX_BODY_BYTES: z.coerce.number().int().min(1_024).max(30 * 1_024 * 1_024).default(2 * 1_024 * 1_024),
    MCP_UPLOAD_TTL_MS: z.coerce.number().int().min(60_000).max(60 * 60_000).default(10 * 60_000),
    MCP_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(120),
    MCP_UPLOADS_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(20),
    MCP_ANONYMOUS_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(60),
    MCP_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
    D4SIGN_CREDENTIAL_BACKEND: z.enum(['environment', 'aws-secrets-manager']).default('environment'),
    D4SIGN_CREDENTIAL_SCOPE: z.enum(['principal', 'tenant']).default('principal'),
    D4SIGN_CREDENTIAL_CACHE_TTL_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    MCP_STATE_BACKEND: z.enum(['memory', 'redis']).default('memory'),
    MCP_UPLOAD_BACKEND: z.enum(['memory', 's3']).default('memory'),
    AWS_REGION: optionalNonEmptyString,
    AWS_CREDENTIALS_SECRET_PREFIX: z.string().trim().min(1).default('d4sign-mcp/credentials'),
    AWS_CREDENTIALS_KMS_KEY_ID: optionalNonEmptyString,
    AWS_REDIS_URL: optionalNonEmptyString,
    AWS_REDIS_USERNAME: optionalNonEmptyString,
    AWS_REDIS_PASSWORD: optionalNonEmptyString,
    AWS_S3_BUCKET: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      s3BucketName.optional(),
    ),
    AWS_S3_PREFIX: z.string().trim().min(1).default('uploads'),
    AWS_S3_REQUIRE_CLEAN_SCAN: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    D4SIGN_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    D4SIGN_TOKEN_API: optionalNonEmptyString,
    D4SIGN_CRYPT_KEY: optionalNonEmptyString,
    D4SIGN_REQUESTS_PER_HOUR: z.coerce
      .number()
      .int()
      .min(1, 'D4SIGN_REQUESTS_PER_HOUR deve refletir a cota positiva da conta D4Sign'),
    D4SIGN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    D4SIGN_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(50 * 1_024 * 1_024)
      .default(2_097_152),
    D4SIGN_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(20 * 1_024 * 1_024)
      .default(10 * 1_024 * 1_024),
    LOG_LEVEL: z.string().trim().min(1).default('info'),
  })
  .loose();

function commaSeparated(value: string): string[] {
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))];
}

function originHostnames(value: string): string[] {
  return commaSeparated(value).map((origin) => {
    try {
      return new URL(origin).hostname;
    } catch {
      throw new Error(`MCP_ALLOWED_ORIGINS contém uma origem inválida: ${origin}`);
    }
  });
}

function requiredValue(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} é obrigatório.`);
  return value;
}

function validateServiceUrl(value: string | undefined, name: string, protocols: string[]): void {
  if (value === undefined) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} deve ser uma URL válida.`);
  }
  if (!protocols.includes(parsed.protocol) || parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error(`${name} deve usar ${protocols.join(' ou ')} e não pode conter credenciais.`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);

  validateServiceUrl(parsed.MCP_PUBLIC_BASE_URL, 'MCP_PUBLIC_BASE_URL', ['https:', 'http:']);
  validateServiceUrl(parsed.OIDC_ISSUER, 'OIDC_ISSUER', ['https:']);
  validateServiceUrl(parsed.OIDC_AUDIENCE, 'OIDC_AUDIENCE', ['https:', 'http:']);
  validateServiceUrl(parsed.OIDC_JWKS_URL, 'OIDC_JWKS_URL', ['https:']);
  validateServiceUrl(parsed.AWS_REDIS_URL, 'AWS_REDIS_URL', ['rediss:']);

  const allowedClientIds = commaSeparated(parsed.OIDC_ALLOWED_CLIENT_IDS);

  if (parsed.MCP_AUTH_MODE === 'oidc') {
    if (parsed.OIDC_ISSUER === undefined) {
      throw new Error('OIDC_ISSUER é obrigatório quando MCP_AUTH_MODE=oidc.');
    }
    // O binding de recurso precisa existir de alguma forma. IdPs com RFC 8707
    // emitem `aud`; o Amazon Cognito não emite `aud` em access token, então o
    // vínculo passa a ser o client ID autorizado somado a `token_use=access`.
    if (parsed.OIDC_AUDIENCE === undefined && allowedClientIds.length === 0) {
      throw new Error(
        'Informe OIDC_AUDIENCE (IdP com RFC 8707) ou OIDC_ALLOWED_CLIENT_IDS (Amazon Cognito) quando MCP_AUTH_MODE=oidc.',
      );
    }
  }
  // MCP_BEARER_TOKEN não é exigido aqui: stdio usa o default `static` e nunca
  // abre porta HTTP. A exigência fica em createAccessTokenVerifier, no momento
  // em que o servidor HTTP é realmente construído.
  if (parsed.D4SIGN_CREDENTIAL_BACKEND === 'environment' && parsed.D4SIGN_TOKEN_API === undefined) {
    throw new Error('D4SIGN_TOKEN_API é obrigatório quando D4SIGN_CREDENTIAL_BACKEND=environment.');
  }
  const usesAws = parsed.D4SIGN_CREDENTIAL_BACKEND === 'aws-secrets-manager'
    || parsed.MCP_STATE_BACKEND === 'redis'
    || parsed.MCP_UPLOAD_BACKEND === 's3';
  if (usesAws && parsed.AWS_REGION === undefined) throw new Error('AWS_REGION é obrigatório para os backends AWS.');
  if (parsed.MCP_STATE_BACKEND === 'redis' && (
    parsed.AWS_REDIS_URL === undefined
    || parsed.AWS_REDIS_USERNAME === undefined
    || parsed.AWS_REDIS_PASSWORD === undefined
  )) {
    throw new Error('AWS_REDIS_URL, AWS_REDIS_USERNAME e AWS_REDIS_PASSWORD são obrigatórios quando MCP_STATE_BACKEND=redis.');
  }
  if (parsed.MCP_UPLOAD_BACKEND === 's3' && parsed.AWS_S3_BUCKET === undefined) {
    throw new Error('AWS_S3_BUCKET é obrigatório quando MCP_UPLOAD_BACKEND=s3.');
  }
  if (parsed.NODE_ENV === 'production') {
    const invalid = [
      parsed.MCP_AUTH_MODE !== 'oidc' && 'MCP_AUTH_MODE=oidc',
      parsed.D4SIGN_CREDENTIAL_BACKEND !== 'aws-secrets-manager' && 'D4SIGN_CREDENTIAL_BACKEND=aws-secrets-manager',
      parsed.MCP_STATE_BACKEND !== 'redis' && 'MCP_STATE_BACKEND=redis',
      parsed.MCP_UPLOAD_BACKEND !== 's3' && 'MCP_UPLOAD_BACKEND=s3',
      !parsed.AWS_S3_REQUIRE_CLEAN_SCAN && 'AWS_S3_REQUIRE_CLEAN_SCAN=true',
      parsed.AWS_CREDENTIALS_KMS_KEY_ID === undefined && 'AWS_CREDENTIALS_KMS_KEY_ID',
      parsed.MCP_REQUEST_STATE_KEY === undefined && 'MCP_REQUEST_STATE_KEY',
      parsed.MCP_PUBLIC_BASE_URL === undefined && 'MCP_PUBLIC_BASE_URL',
    ].filter((item): item is string => typeof item === 'string');
    if (invalid.length > 0) throw new Error(`Configuração de produção incompleta: ${invalid.join(', ')}.`);
    if (parsed.MCP_PUBLIC_BASE_URL?.startsWith('https://') !== true) {
      throw new Error('MCP_PUBLIC_BASE_URL deve usar HTTPS em produção.');
    }
    // Quando o IdP emite `aud`, ele precisa apontar exatamente para este recurso.
    // Quando não emite, `OIDC_ALLOWED_CLIENT_IDS` já foi exigido acima.
    if (parsed.OIDC_AUDIENCE !== undefined && parsed.OIDC_AUDIENCE !== `${parsed.MCP_PUBLIC_BASE_URL}/mcp`) {
      throw new Error('OIDC_AUDIENCE, quando definido, deve ser exatamente MCP_PUBLIC_BASE_URL + /mcp.');
    }
  }

  const d4sign = {
    environment: parsed.D4SIGN_ENVIRONMENT,
    requestsPerHour: parsed.D4SIGN_REQUESTS_PER_HOUR,
    timeoutMs: parsed.D4SIGN_TIMEOUT_MS,
    maxResponseBytes: parsed.D4SIGN_MAX_RESPONSE_BYTES,
    maxUploadBytes: parsed.D4SIGN_MAX_UPLOAD_BYTES,
    ...(parsed.D4SIGN_TOKEN_API === undefined ? {} : { tokenApi: parsed.D4SIGN_TOKEN_API }),
    ...(parsed.D4SIGN_CRYPT_KEY === undefined ? {} : { cryptKey: parsed.D4SIGN_CRYPT_KEY }),
  };
  const oidcIssuer = parsed.MCP_AUTH_MODE === 'oidc' ? requiredValue(parsed.OIDC_ISSUER, 'OIDC_ISSUER') : undefined;

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    allowedHosts: commaSeparated(parsed.MCP_ALLOWED_HOSTS),
    allowedOriginHosts: originHostnames(parsed.MCP_ALLOWED_ORIGINS),
    ...(parsed.MCP_PUBLIC_BASE_URL === undefined ? {} : { publicBaseUrl: parsed.MCP_PUBLIC_BASE_URL.replace(/\/$/u, '') }),
    authMode: parsed.MCP_AUTH_MODE,
    ...(parsed.MCP_BEARER_TOKEN === undefined ? {} : { mcpBearerToken: parsed.MCP_BEARER_TOKEN }),
    ...(parsed.MCP_AUTH_MODE === 'oidc'
      ? {
          oidc: {
            issuer: requiredValue(oidcIssuer, 'OIDC_ISSUER').replace(/\/$/u, ''),
            ...(parsed.OIDC_AUDIENCE === undefined
              ? {}
              : { audience: parsed.OIDC_AUDIENCE.replace(/\/$/u, '') }),
            ...(allowedClientIds.length === 0 ? {} : { allowedClientIds }),
            jwksUrl: parsed.OIDC_JWKS_URL
              ?? `${requiredValue(oidcIssuer, 'OIDC_ISSUER').replace(/\/$/u, '')}/.well-known/jwks.json`,
            scopePrefix: parsed.OIDC_SCOPE_PREFIX.replace(/\/$/u, ''),
            ...(parsed.OIDC_TENANT_CLAIM === undefined ? {} : { tenantClaim: parsed.OIDC_TENANT_CLAIM }),
          },
        }
      : {}),
    ...(parsed.MCP_REQUEST_STATE_KEY === undefined ? {} : { requestStateKey: parsed.MCP_REQUEST_STATE_KEY }),
    mcpMaxBodyBytes: parsed.MCP_MAX_BODY_BYTES,
    mcpUploadTtlMs: parsed.MCP_UPLOAD_TTL_MS,
    mcpRequestsPerMinute: parsed.MCP_REQUESTS_PER_MINUTE,
    mcpUploadsPerMinute: parsed.MCP_UPLOADS_PER_MINUTE,
    mcpAnonymousRequestsPerMinute: parsed.MCP_ANONYMOUS_REQUESTS_PER_MINUTE,
    mcpShutdownGraceMs: parsed.MCP_SHUTDOWN_GRACE_MS,
    credentialBackend: parsed.D4SIGN_CREDENTIAL_BACKEND,
    credentialScope: parsed.D4SIGN_CREDENTIAL_SCOPE,
    credentialCacheTtlMs: parsed.D4SIGN_CREDENTIAL_CACHE_TTL_MS,
    stateBackend: parsed.MCP_STATE_BACKEND,
    uploadBackend: parsed.MCP_UPLOAD_BACKEND,
    aws: {
      ...(parsed.AWS_REGION === undefined ? {} : { region: parsed.AWS_REGION }),
      credentialsSecretPrefix: parsed.AWS_CREDENTIALS_SECRET_PREFIX.replace(/\/$/u, ''),
      ...(parsed.AWS_CREDENTIALS_KMS_KEY_ID === undefined ? {} : { credentialsKmsKeyId: parsed.AWS_CREDENTIALS_KMS_KEY_ID }),
      ...(parsed.AWS_S3_BUCKET === undefined ? {} : { s3Bucket: parsed.AWS_S3_BUCKET }),
      s3Prefix: parsed.AWS_S3_PREFIX.replace(/^\/+|\/+$/gu, ''),
      requireCleanS3Scan: parsed.AWS_S3_REQUIRE_CLEAN_SCAN,
      ...(parsed.AWS_REDIS_URL === undefined ? {} : { redisUrl: parsed.AWS_REDIS_URL }),
      ...(parsed.AWS_REDIS_USERNAME === undefined ? {} : { redisUsername: parsed.AWS_REDIS_USERNAME }),
      ...(parsed.AWS_REDIS_PASSWORD === undefined ? {} : { redisPassword: parsed.AWS_REDIS_PASSWORD }),
    },
    d4sign,
    logLevel: parsed.LOG_LEVEL,
  };
}
