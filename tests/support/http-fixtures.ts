import pino from 'pino';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import type { AppConfig } from '../../src/config/types.js';
import { InMemoryClaimStore } from '../../src/infra/claim-store.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { InMemoryRateLimiter } from '../../src/infra/rate-limiter.js';
import { InMemoryUploadStore } from '../../src/infra/upload-store.js';
import type { ServerDependencies } from '../../src/server/dependencies.js';
import { ConfirmationWorkflow } from '../../src/server/confirmation-workflow.js';
import { D4SignFileService } from '../../src/services/d4sign-file-service.js';
import { D4SignReadService } from '../../src/services/d4sign-read-service.js';
import { D4SignWriteService } from '../../src/services/d4sign-write-service.js';

export const logger = pino({ enabled: false });

export const OIDC_ISSUER = 'https://cognito-idp.sa-east-1.amazonaws.com/sa-east-1_exemplo';
export const PUBLIC_BASE_URL = 'https://mcp.exemplo.com.br';

export function oidcConfig(overrides: Partial<NonNullable<AppConfig['oidc']>> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    host: '127.0.0.1',
    allowedHosts: ['127.0.0.1'],
    allowedOriginHosts: ['localhost'],
    publicBaseUrl: PUBLIC_BASE_URL,
    authMode: 'oidc',
    oidc: {
      issuer: OIDC_ISSUER,
      allowedClientIds: ['client-publico'],
      jwksUrl: `${OIDC_ISSUER}/.well-known/jwks.json`,
      scopePrefix: 'd4sign-mcp',
      ...overrides,
    },
    mcpMaxBodyBytes: 100_000,
    mcpUploadTtlMs: 600_000,
    mcpRequestsPerMinute: 1_000,
    mcpUploadsPerMinute: 100,
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
      requestsPerHour: 100,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      maxUploadBytes: 10_000_000,
    },
    logLevel: 'silent',
  };
}

export function buildDependencies(): ServerDependencies {
  const credentialProvider = new MockCredentialProvider({ tokenApi: 'token-de-teste', environment: 'sandbox' });
  const cache = new InMemoryPrivateCache();
  const quotaManager = new InMemoryQuotaManager(100);
  const uploadStore = new InMemoryUploadStore(600_000);
  const fetchImpl: typeof fetch = () => Promise.resolve(new Response('[]', { status: 200 }));
  const shared = { credentialProvider, cache, quotaManager, logger, timeoutMs: 1_000, maxResponseBytes: 50_000, fetchImpl };
  return {
    transport: 'http',
    readService: new D4SignReadService(shared),
    writeService: new D4SignWriteService(shared),
    fileService: new D4SignFileService({
      ...shared,
      uploadStore,
      claimStore: new InMemoryClaimStore(),
      maxUploadBytes: 10_000_000,
    }),
    uploadStore,
    confirmationWorkflow: new ConfirmationWorkflow({
      key: 'test-request-state-key-with-at-least-32-bytes',
      transport: 'http',
    }),
    rateLimiter: new InMemoryRateLimiter(),
    logger,
  };
}
