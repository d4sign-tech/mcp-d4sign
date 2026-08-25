import { randomBytes } from 'node:crypto';

import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { S3Client } from '@aws-sdk/client-s3';
import { createClient } from 'redis';

import {
  AwsSdkSecretsManagerApi,
  AwsSecretsManagerCredentialProvider,
  EnvironmentCredentialProvider,
  type CredentialProvider,
  type WritableCredentialProvider,
} from '../auth/credential-provider.js';
import type { AppConfig, McpTransport } from '../config/types.js';
import { InMemoryPrivateCache, RedisPrivateCache, type Cache, type RedisCacheClient } from '../infra/cache.js';
import { InMemoryClaimStore, RedisClaimStore, type ClaimStore, type RedisClaimClient } from '../infra/claim-store.js';
import {
  InMemoryGenerationStore,
  RedisGenerationStore,
  type GenerationStore,
  type RedisGenerationClient,
} from '../infra/generation-store.js';
import type { AppLogger } from '../infra/logger.js';
import { InMemoryQuotaManager, RedisQuotaManager, type QuotaManager, type RedisQuotaClient } from '../infra/quota-manager.js';
import { InMemoryRateLimiter, RedisRateLimiter, type RateLimiter, type RedisRateLimitClient } from '../infra/rate-limiter.js';
import { InMemoryReplayStore, RedisReplayStore, type RedisReplayClient, type ReplayStore } from '../infra/replay-store.js';
import { AwsSdkS3ObjectApi, InMemoryUploadStore, S3UploadStore, type UploadStore } from '../infra/upload-store.js';
import { D4SignFileService } from '../services/d4sign-file-service.js';
import { D4SignReadService } from '../services/d4sign-read-service.js';
import { D4SignWriteService } from '../services/d4sign-write-service.js';
import { ConfirmationWorkflow } from './confirmation-workflow.js';

export type ReadinessCheck = 'ok' | 'unavailable' | 'not-configured';

export interface ReadinessReport {
  ready: boolean;
  checks: Record<string, ReadinessCheck>;
}

export interface ServerDependencies {
  transport: McpTransport;
  readService: D4SignReadService;
  writeService: D4SignWriteService;
  fileService: D4SignFileService;
  uploadStore: UploadStore;
  confirmationWorkflow: ConfirmationWorkflow;
  credentialProvider?: CredentialProvider;
  credentialStore?: WritableCredentialProvider;
  rateLimiter?: RateLimiter;
  logger: AppLogger;
  /**
   * Verificação de dependências usada por `/health/ready`.
   *
   * Precisa observar o estado corrente, não apenas o boot: o ALB usa esse
   * endpoint continuamente, e um readiness que sempre responde 200 impede o
   * circuit breaker do ECS de detectar uma task degradada.
   */
  readiness?(): Promise<ReadinessReport>;
  close?(): Promise<void>;
}

export async function createDependencies(
  config: AppConfig,
  logger: AppLogger,
  fetchImpl?: typeof fetch,
  transport: McpTransport = 'http',
): Promise<ServerDependencies> {
  let redisClient: ReturnType<typeof createClient> | undefined;
  let generations: GenerationStore = new InMemoryGenerationStore();
  let cache: Cache = new InMemoryPrivateCache(500, generations);
  let quotaManager: QuotaManager = new InMemoryQuotaManager(config.d4sign.requestsPerHour);
  let rateLimiter: RateLimiter = new InMemoryRateLimiter();
  let replayStore: ReplayStore = new InMemoryReplayStore();
  let claimStore: ClaimStore = new InMemoryClaimStore();

  if (config.stateBackend === 'redis') {
    const redisUrl = config.aws?.redisUrl;
    const redisUsername = config.aws?.redisUsername;
    const redisPassword = config.aws?.redisPassword;
    if (redisUrl === undefined || redisUsername === undefined || redisPassword === undefined) {
      throw new Error('Configuração ElastiCache ausente.');
    }
    redisClient = createClient({
      url: redisUrl,
      username: redisUsername,
      password: redisPassword,
      // A ACL do ElastiCache é restrita aos comandos usados pela aplicação;
      // `CLIENT SETINFO` não faz parte dela e não deve derrubar a conexão.
      disableClientInfo: true,
      socket: { reconnectStrategy: (retries) => Math.min(1_000 * 2 ** retries, 15_000) },
    });
    redisClient.on('error', (error) => logger.error({ err: error }, 'Erro no Amazon ElastiCache'));
    await redisClient.connect();
    const shared = redisClient as unknown as RedisCacheClient
      & RedisQuotaClient
      & RedisRateLimitClient
      & RedisReplayClient
      & RedisGenerationClient
      & RedisClaimClient;
    generations = new RedisGenerationStore(shared);
    cache = new RedisPrivateCache(shared, generations);
    quotaManager = new RedisQuotaManager(shared, config.d4sign.requestsPerHour);
    rateLimiter = new RedisRateLimiter(shared);
    replayStore = new RedisReplayStore(shared);
    claimStore = new RedisClaimStore(shared);
  }

  let writableCredentialProvider: WritableCredentialProvider | undefined;
  let credentialProvider: CredentialProvider;
  if (config.credentialBackend === 'aws-secrets-manager') {
    const region = config.aws?.region;
    if (region === undefined) throw new Error('AWS_REGION ausente.');
    writableCredentialProvider = new AwsSecretsManagerCredentialProvider(
      new AwsSdkSecretsManagerApi(new SecretsManagerClient({ region })),
      {
        secretPrefix: config.aws?.credentialsSecretPrefix ?? 'd4sign-mcp/credentials',
        scope: config.credentialScope,
        cacheTtlMs: config.credentialCacheTtlMs,
        // Rotação e revogação precisam alcançar todas as tasks, não só a que
        // atendeu a requisição: a geração compartilhada é o sinal de invalidação.
        generations,
        ...(config.aws?.credentialsKmsKeyId === undefined ? {} : { kmsKeyId: config.aws.credentialsKmsKeyId }),
      },
    );
    credentialProvider = writableCredentialProvider;
  } else {
    if (config.d4sign.tokenApi === undefined) throw new Error('D4SIGN_TOKEN_API ausente.');
    credentialProvider = new EnvironmentCredentialProvider({
      tokenApi: config.d4sign.tokenApi,
      environment: config.d4sign.environment,
      requestsPerHour: config.d4sign.requestsPerHour,
      ...(config.d4sign.cryptKey === undefined ? {} : { cryptKey: config.d4sign.cryptKey }),
    });
  }

  let uploadStore: UploadStore = new InMemoryUploadStore(config.mcpUploadTtlMs);
  let s3UploadStore: S3UploadStore | undefined;
  if (config.uploadBackend === 's3') {
    const region = config.aws?.region;
    const bucket = config.aws?.s3Bucket;
    if (region === undefined || bucket === undefined) throw new Error('Configuração S3 ausente.');
    s3UploadStore = new S3UploadStore(
      new AwsSdkS3ObjectApi(new S3Client({ region })),
      bucket,
      config.aws?.s3Prefix ?? 'uploads',
      config.mcpUploadTtlMs,
      config.d4sign.maxUploadBytes,
      Date.now,
      config.aws?.requireCleanS3Scan ?? false,
    );
    await s3UploadStore.ensureBucket();
    uploadStore = s3UploadStore;
  }

  const readService = new D4SignReadService({
    credentialProvider,
    cache,
    quotaManager,
    logger,
    timeoutMs: config.d4sign.timeoutMs,
    maxResponseBytes: config.d4sign.maxResponseBytes,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  const writeService = new D4SignWriteService({
    credentialProvider,
    cache,
    quotaManager,
    logger,
    timeoutMs: config.d4sign.timeoutMs,
    maxResponseBytes: config.d4sign.maxResponseBytes,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });
  const fileService = new D4SignFileService({
    credentialProvider,
    cache,
    quotaManager,
    uploadStore,
    claimStore,
    logger,
    timeoutMs: config.d4sign.timeoutMs,
    maxResponseBytes: config.d4sign.maxResponseBytes,
    maxUploadBytes: config.d4sign.maxUploadBytes,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  });

  const confirmationWorkflow = new ConfirmationWorkflow({
    key: config.requestStateKey ?? randomBytes(32),
    transport,
    replayStore,
  });

  const readiness = async (): Promise<ReadinessReport> => {
    const checks: Record<string, ReadinessCheck> = {};

    // O estado compartilhado é bloqueante: sem ele não há cache, cota, rate
    // limit nem anti-replay, então a task não deve receber tráfego.
    if (config.stateBackend === 'redis') {
      try {
        if (redisClient?.isOpen !== true) throw new Error('conexão fechada');
        // Toque real no Redis, dentro do prefixo permitido pela ACL.
        await generations.current('readiness-probe');
        checks.state = 'ok';
      } catch {
        checks.state = 'unavailable';
      }
    } else {
      checks.state = 'not-configured';
    }

    // O S3 é informativo, não bloqueante: uma oscilação do bucket afeta apenas
    // as quatro tools de upload, e tirar todas as tasks do balanceador por isso
    // derrubaria as outras 38 sem necessidade.
    if (s3UploadStore !== undefined) {
      try {
        await s3UploadStore.ensureBucket();
        checks.uploads = 'ok';
      } catch {
        checks.uploads = 'unavailable';
        logger.warn({ event: 'readiness_uploads_degraded' }, 'Bucket de uploads inacessível');
      }
    } else {
      checks.uploads = 'not-configured';
    }

    return { ready: checks.state !== 'unavailable', checks };
  };

  return {
    transport,
    readService,
    writeService,
    fileService,
    uploadStore,
    confirmationWorkflow,
    credentialProvider,
    ...(writableCredentialProvider === undefined ? {} : { credentialStore: writableCredentialProvider }),
    rateLimiter,
    logger,
    readiness,
    async close() {
      if (redisClient?.isOpen === true) await redisClient.quit();
    },
  };
}
