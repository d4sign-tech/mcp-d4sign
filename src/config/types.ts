export type D4SignEnvironment = 'sandbox' | 'production';
export type McpAuthMode = 'static' | 'oidc';
export type McpTransport = 'stdio' | 'http';
export type CredentialBackend = 'environment' | 'aws-secrets-manager';
export type StateBackend = 'memory' | 'redis';
export type UploadBackend = 'memory' | 's3';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  allowedHosts: string[];
  allowedOriginHosts: string[];
  publicBaseUrl?: string;
  authMode: McpAuthMode;
  mcpBearerToken?: string;
  oidc?: {
    issuer: string;
    /**
     * Presente somente quando o IdP emite `aud` no access token, o que exige
     * suporte a RFC 8707. O Amazon Cognito não emite `aud` em access token:
     * nesse caso o binding de recurso usa `allowedClientIds` + `token_use`.
     */
    audience?: string;
    /**
     * Client IDs OAuth aceitos. Obrigatório quando `audience` está ausente,
     * porque passa a ser o único vínculo entre o token e este recurso.
     */
    allowedClientIds?: string[];
    jwksUrl: string;
    scopePrefix: string;
    tenantClaim?: string;
    /**
     * Publica `/.well-known/oauth-authorization-server` com PKCE e aponta o
     * recurso protegido para esta origem. Necessário com provedores que não
     * declaram `code_challenge_methods_supported` (Amazon Cognito).
     */
    metadataFacade?: boolean;
  };
  requestStateKey?: string;
  mcpMaxBodyBytes: number;
  mcpUploadTtlMs: number;
  mcpRequestsPerMinute: number;
  mcpUploadsPerMinute: number;
  /** Limite por IP aplicado antes da autenticação, contra flood não autenticado. */
  mcpAnonymousRequestsPerMinute: number;
  /** Prazo máximo de drenagem de conexões no encerramento gracioso. */
  mcpShutdownGraceMs: number;
  credentialBackend: CredentialBackend;
  credentialScope: 'principal' | 'tenant';
  /** TTL do cache local de credenciais; invalidação distribuída usa Redis. */
  credentialCacheTtlMs: number;
  stateBackend: StateBackend;
  uploadBackend: UploadBackend;
  aws?: {
    region?: string;
    credentialsSecretPrefix: string;
    credentialsKmsKeyId?: string;
    s3Bucket?: string;
    s3Prefix: string;
    requireCleanS3Scan: boolean;
    redisUrl?: string;
    redisUsername?: string;
    redisPassword?: string;
  };
  d4sign: {
    environment: D4SignEnvironment;
    tokenApi?: string;
    cryptKey?: string;
    requestsPerHour: number;
    timeoutMs: number;
    maxResponseBytes: number;
    maxUploadBytes: number;
  };
  logLevel: string;
}
