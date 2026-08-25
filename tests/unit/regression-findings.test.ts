import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  AwsSecretsManagerCredentialProvider,
  CredentialNotConfiguredError,
  type SecretsManagerApi,
} from '../../src/auth/credential-provider.js';
import { D4SignClient } from '../../src/d4sign/client.js';
import { parseRetryAfterSeconds } from '../../src/d4sign/client.js';
import { UploadError, UploadScanPendingError } from '../../src/d4sign/errors.js';
import {
  parseTagRemovedResponse,
  parseTagsResponse,
  parseUrgentTagRemovedResponse,
  parseUserVerificationResponse,
  parseVaultsResponse,
  parseWebhooksResponse,
} from '../../src/d4sign/schemas.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryClaimStore } from '../../src/infra/claim-store.js';
import { InMemoryGenerationStore, RedisGenerationStore } from '../../src/infra/generation-store.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { InMemoryUploadStore, S3UploadStore, type S3ObjectApi } from '../../src/infra/upload-store.js';
import { D4SignFileService } from '../../src/services/d4sign-file-service.js';
import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { toToolError } from '../../src/shared/result.js';
import { FakeRedis } from '../support/fake-redis.js';

const logger = pino({ enabled: false });
const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';

function awsError(name: string, httpStatusCode: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
}

describe('Upload no S3 com verificação antimalware', () => {
  function s3(overrides: Partial<S3ObjectApi> = {}): { api: S3ObjectApi; state: { deleted: string[]; tags: Record<string, string> } } {
    const state = { deleted: [] as string[], tags: {} as Record<string, string> };
    const bytes = Buffer.from('%PDF-1.7 conteudo');
    const metadata: Record<string, string> = {};
    const api: S3ObjectApi = {
      ensureBucket: () => Promise.resolve(),
      putObject: (input) => {
        Object.assign(metadata, input.metadata);
        return Promise.resolve();
      },
      headObject: () => Promise.resolve({
        metadata,
        contentLength: bytes.byteLength,
        versionId: 'versao-1',
      }),
      getObjectTags: () => Promise.resolve(state.tags),
      getObjectBytes: () => Promise.resolve(Uint8Array.from(bytes)),
      deleteObject: (_bucket, key, versionId) => {
        state.deleted.push(`${key}#${versionId ?? 'sem-versao'}`);
        return Promise.resolve();
      },
      ...overrides,
    };
    return { api, state };
  }

  const auth = { principalId: 'principal-a', tenantId: 'tenant-a' };
  const file = { fileName: 'contrato.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.7 conteudo') };

  it('devolve erro transitório retentável enquanto a tag do GuardDuty não existe', async () => {
    const { api } = s3();
    const store = new S3UploadStore(api, 'bucket', 'uploads', 60_000, 10_000, () => 1_000, true);
    const receipt = await store.put(auth, file);

    await expect(store.get(auth, receipt.uploadHandle)).rejects.toBeInstanceOf(UploadScanPendingError);
    const semantic = JSON.parse(
      (toToolError(new UploadScanPendingError()).content[0] as { text: string }).text,
    ) as Record<string, unknown>;
    expect(semantic).toMatchObject({ code: 'UPLOAD_SCAN_PENDING', retryable: true, suggestedAction: 'wait_and_retry' });
  });

  it('trata AccessDenied da bucket policy como scan pendente, não como erro interno', async () => {
    // A policy DenyUnscannedObjectReads nega s3:GetObject sem a tag limpa, e
    // HeadObject é autorizado como s3:GetObject. Sem este mapeamento o agente
    // recebe INTERNAL_ERROR/contact_support e desiste de um upload válido.
    const { api } = s3({
      headObject: () => Promise.reject(awsError('AccessDenied', 403)),
      getObjectTags: () => Promise.reject(awsError('AccessDenied', 403)),
    });
    const store = new S3UploadStore(api, 'bucket', 'uploads', 60_000, 10_000, () => 1_000, true);
    await expect(store.get(auth, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'))
      .rejects.toBeInstanceOf(UploadScanPendingError);
  });

  it('consulta a tag antes do HeadObject para não tropeçar na bucket policy', async () => {
    const ordem: string[] = [];
    const base = s3();
    const store = new S3UploadStore(
      {
        ...base.api,
        headObject: (bucket, key) => {
          ordem.push('headObject');
          return base.api.headObject(bucket, key);
        },
        getObjectTags: (bucket, key) => {
          ordem.push('getObjectTags');
          return base.api.getObjectTags(bucket, key);
        },
      },
      'bucket',
      'uploads',
      60_000,
      10_000,
      () => 1_000,
      true,
    );
    const receipt = await store.put(auth, file);
    base.state.tags.GuardDutyMalwareScanStatus = 'NO_THREATS_FOUND';
    await store.get(auth, receipt.uploadHandle);
    expect(ordem[0]).toBe('getObjectTags');
  });

  it('apaga a versão específica ao rejeitar upload infectado', async () => {
    const { api, state } = s3();
    const store = new S3UploadStore(api, 'bucket', 'uploads', 60_000, 10_000, () => 1_000, true);
    const receipt = await store.put(auth, file);
    state.tags.GuardDutyMalwareScanStatus = 'THREATS_FOUND';

    await expect(store.get(auth, receipt.uploadHandle)).rejects.toThrow('rejeitado pela verificação antimalware');
    // Sem VersionId o conteúdo permaneceria recuperável como versão não-corrente.
    expect(state.deleted).toEqual([`uploads/${receipt.uploadHandle}#versao-1`]);
  });

  it('apaga a versão específica ao consumir o handle com sucesso', async () => {
    const { api, state } = s3();
    const store = new S3UploadStore(api, 'bucket', 'uploads', 60_000, 10_000, () => 1_000, false);
    const receipt = await store.put(auth, file);
    await store.delete(auth, receipt.uploadHandle);
    expect(state.deleted).toEqual([`uploads/${receipt.uploadHandle}#versao-1`]);
  });
});

describe('Consumo exclusivo do uploadHandle', () => {
  function fileService(fetchImpl: typeof fetch, uploadStore: InMemoryUploadStore): D4SignFileService {
    const generations = new InMemoryGenerationStore();
    return new D4SignFileService({
      credentialProvider: new MockCredentialProvider({ tokenApi: 'token', environment: 'sandbox' }),
      cache: new InMemoryPrivateCache(500, generations),
      quotaManager: new InMemoryQuotaManager(100),
      uploadStore,
      claimStore: new InMemoryClaimStore(),
      logger,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      maxUploadBytes: 1_000_000,
      fetchImpl,
    });
  }

  it('impede que duas chamadas simultâneas com o mesmo handle criem dois documentos', async () => {
    const auth = { principalId: 'p', tenantId: 't' };
    const uploadStore = new InMemoryUploadStore(600_000);
    const receipt = await uploadStore.put(auth, {
      fileName: 'contrato.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7 conteudo'),
    });
    let inflight = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      inflight += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      inflight -= 1;
      return new Response(JSON.stringify({ uuid: documentUuid }), { status: 200 });
    });
    const service = fileService(fetchImpl, uploadStore);

    const resultados = await Promise.allSettled([
      service.uploadMainFromHandle(auth, { vaultUuid, uploadHandle: receipt.uploadHandle }),
      service.uploadMainFromHandle(auth, { vaultUuid, uploadHandle: receipt.uploadHandle }),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejeitadas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejeitadas).toHaveLength(1);
    expect(rejeitadas[0]?.reason).toBeInstanceOf(UploadError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(inflight).toBe(0);
  });

  it('devolve o claim quando a D4Sign falha, permitindo retry com o mesmo handle', async () => {
    const auth = { principalId: 'p', tenantId: 't' };
    const uploadStore = new InMemoryUploadStore(600_000);
    const receipt = await uploadStore.put(auth, {
      fileName: 'contrato.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.7 conteudo'),
    });
    let tentativa = 0;
    const fetchImpl = vi.fn<typeof fetch>(() => {
      tentativa += 1;
      return Promise.resolve(tentativa === 1
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ uuid: documentUuid }), { status: 200 }));
    });
    const service = fileService(fetchImpl, uploadStore);

    await expect(service.uploadMainFromHandle(auth, { vaultUuid, uploadHandle: receipt.uploadHandle })).rejects.toThrow();
    await expect(service.uploadMainFromHandle(auth, { vaultUuid, uploadHandle: receipt.uploadHandle }))
      .resolves.toMatchObject({ documentUuid });
  });
});

describe('Propagação de rotação e revogação de credenciais', () => {
  class FakeSecretsManager implements SecretsManagerApi {
    readonly values = new Map<string, string>();

    getSecretValue(name: string): Promise<string | undefined> {
      const value = this.values.get(name);
      return value === undefined
        ? Promise.reject(Object.assign(new Error('ResourceNotFoundException'), { name: 'ResourceNotFoundException' }))
        : Promise.resolve(value);
    }

    createSecret(name: string, value: string): Promise<void> {
      this.values.set(name, value);
      return Promise.resolve();
    }

    putSecretValue(name: string, value: string): Promise<void> {
      if (!this.values.has(name)) {
        return Promise.reject(Object.assign(new Error('ResourceNotFoundException'), { name: 'ResourceNotFoundException' }));
      }
      this.values.set(name, value);
      return Promise.resolve();
    }

    deleteSecret(name: string): Promise<void> {
      this.values.delete(name);
      return Promise.resolve();
    }

    restoreSecret(): Promise<void> {
      return Promise.resolve();
    }
  }

  /** Duas instâncias sobre o mesmo Redis simulam duas tasks ECS. */
  function replicas(secrets: FakeSecretsManager, redis: FakeRedis) {
    const build = (): AwsSecretsManagerCredentialProvider => new AwsSecretsManagerCredentialProvider(secrets, {
      secretPrefix: 'd4sign-mcp/credentials',
      scope: 'principal',
      cacheTtlMs: 300_000,
      generations: new RedisGenerationStore(redis),
    });
    return { taskA: build(), taskB: build() };
  }

  const context = { principalId: 'alice@example.com', tenantId: 'tenant-a' };

  it('revogação em uma task invalida o cache das demais sem esperar o TTL', async () => {
    const secrets = new FakeSecretsManager();
    const redis = new FakeRedis();
    const { taskA, taskB } = replicas(secrets, redis);

    await taskA.setCredentials(context, { tokenApi: 'token-1', environment: 'production', requestsPerHour: 1_000 });
    await expect(taskB.getCredentials(context)).resolves.toMatchObject({ tokenApi: 'token-1' });

    await taskA.deleteCredentials(context);
    // Sem invalidação distribuída, taskB continuaria servindo token-1 por minutos.
    await expect(taskB.getCredentials(context)).rejects.toBeInstanceOf(CredentialNotConfiguredError);
  });

  it('rotação em uma task é vista imediatamente pelas demais', async () => {
    const secrets = new FakeSecretsManager();
    const redis = new FakeRedis();
    const { taskA, taskB } = replicas(secrets, redis);

    await taskA.setCredentials(context, { tokenApi: 'token-1', environment: 'production', requestsPerHour: 1_000 });
    await expect(taskB.getCredentials(context)).resolves.toMatchObject({ tokenApi: 'token-1' });

    await taskA.setCredentials(context, { tokenApi: 'token-2', environment: 'production', requestsPerHour: 1_000 });
    await expect(taskB.getCredentials(context)).resolves.toMatchObject({ tokenApi: 'token-2' });
  });

  it('load em voo não recacheia o valor antigo depois da rotação', async () => {
    const secrets = new FakeSecretsManager();
    const redis = new FakeRedis();
    const generations = new RedisGenerationStore(redis);
    const provider = new AwsSecretsManagerCredentialProvider(secrets, {
      secretPrefix: 'd4sign-mcp/credentials',
      scope: 'principal',
      cacheTtlMs: 300_000,
      generations,
    });
    await provider.setCredentials(context, { tokenApi: 'token-1', environment: 'production', requestsPerHour: 1_000 });

    let liberar: (() => void) | undefined;
    const original = secrets.getSecretValue.bind(secrets);
    secrets.getSecretValue = async (name) => {
      const value = await original(name);
      await new Promise<void>((resolve) => { liberar = resolve; });
      return value;
    };

    const emVoo = provider.getCredentials(context);
    await Promise.resolve();
    secrets.getSecretValue = original;
    await provider.setCredentials(context, { tokenApi: 'token-2', environment: 'production', requestsPerHour: 1_000 });
    liberar?.();
    await emVoo;

    await expect(provider.getCredentials(context)).resolves.toMatchObject({ tokenApi: 'token-2' });
  });
});

describe('Respostas D4Sign fora do caminho felizes', () => {
  it('documento sem webhook devolve lista vazia em vez de erro de contrato', () => {
    expect(parseWebhooksResponse([], documentUuid)).toEqual({ documentUuid, webhooks: [] });
    expect(parseWebhooksResponse({ message: 'Nenhum webhook' }, documentUuid)).toEqual({ documentUuid, webhooks: [] });
    expect(parseWebhooksResponse(undefined, documentUuid)).toEqual({ documentUuid, webhooks: [] });
  });

  it('webhook de outro documento continua sendo rejeitado', () => {
    expect(() => parseWebhooksResponse(
      [{ uuid: vaultUuid, webhook_url: 'https://exemplo.test/hook' }],
      documentUuid,
    )).toThrow();
  });

  it('remoção da última tag não é reportada como falha', () => {
    const esperado = { documentUuid, tag: 'jurídico' };
    expect(parseTagRemovedResponse({ message: 'ok', TAGs: '' }, esperado)).toMatchObject({ success: true });
    expect(parseTagRemovedResponse({ message: 'ok' }, esperado)).toMatchObject({ success: true });
    expect(parseTagRemovedResponse({ message: 'ok', TAGs: null }, esperado)).toMatchObject({ success: true });
    expect(parseUrgentTagRemovedResponse({ message: 'ok', TAGs: '' }, documentUuid))
      .toMatchObject({ success: true, tag: 'URGENTE' });
    expect(parseUrgentTagRemovedResponse({ message: 'ok' }, documentUuid)).toMatchObject({ success: true });
  });

  it('resposta sem message continua sendo violação de contrato', () => {
    expect(() => parseTagRemovedResponse({ TAGs: 'a' }, { documentUuid, tag: 'a' })).toThrow();
  });

  it('lista de tags tolera objeto único dentro de array', () => {
    expect(parseTagsResponse([{ uuid_arquivo: documentUuid, TAGs: 'a, b' }]))
      .toEqual({ documentUuid, tags: ['a', 'b'] });
  });

  it('usuário inexistente devolve status semântico em vez de erro de contrato', () => {
    expect(parseUserVerificationResponse({ message: 'Usuário não encontrado' }, 'ausente@example.com'))
      .toEqual({ email: 'ausente@example.com', status: 'not_found' });
    // Sem o e-mail solicitado não há como montar a resposta: segue rejeitando.
    expect(() => parseUserVerificationResponse({ message: 'x' })).toThrow();
  });

  it('lista de cofres acima do limite de saída é rejeitada no parser', () => {
    const muitos = Array.from({ length: 1_001 }, () => ({ uuid_safe: vaultUuid, 'name-safe': 'Cofre' }));
    expect(() => parseVaultsResponse(muitos)).toThrow();
  });
});

describe('Contrato de erro do cliente D4Sign', () => {
  function client(fetchImpl: typeof fetch): D4SignClient {
    return new D4SignClient({
      credentials: { tokenApi: 'token', environment: 'sandbox' },
      quotaManager: new InMemoryQuotaManager(100),
      logger,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      fetchImpl,
      retryBaseDelayMs: 1,
    });
  }

  it('interpreta Retry-After em segundos e em data HTTP', () => {
    const agora = () => Date.parse('2026-08-20T12:00:00Z');
    expect(parseRetryAfterSeconds('120', agora)).toBe(120);
    expect(parseRetryAfterSeconds('Thu, 20 Aug 2026 12:02:00 GMT', agora)).toBe(120);
    expect(parseRetryAfterSeconds(null, agora)).toBeUndefined();
    expect(parseRetryAfterSeconds('nao-e-data', agora)).toBeUndefined();
    // Teto de um dia, para não devolver cooldown absurdo ao agente.
    expect(parseRetryAfterSeconds('999999999', agora)).toBe(86_400);
  });

  it('propaga o cooldown do 429 upstream para o erro semântico', async () => {
    const target = client(() => Promise.resolve(new Response('{}', {
      status: 429,
      headers: { 'Retry-After': '90' },
    })));
    const error = await target.request({ method: 'GET', path: '/safes' }).catch((caught: unknown) => caught);
    const semantic = JSON.parse((toToolError(error).content[0] as { text: string }).text) as Record<string, unknown>;
    expect(semantic).toMatchObject({
      code: 'D4SIGN_RATE_LIMITED',
      category: 'rate_limit',
      suggestedAction: 'wait_and_retry',
      cooldownSeconds: 90,
    });
  });

  it('cancelamento durante o backoff vira REQUEST_CANCELLED, não erro interno', async () => {
    const controller = new AbortController();
    const target = new D4SignClient({
      credentials: { tokenApi: 'token', environment: 'sandbox' },
      quotaManager: new InMemoryQuotaManager(100),
      logger,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      fetchImpl: () => {
        setTimeout(() => controller.abort(), 0);
        return Promise.resolve(new Response('{}', { status: 503 }));
      },
      retryBaseDelayMs: 50,
    });
    const error = await target
      .request({ method: 'GET', path: '/safes', signal: controller.signal })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'REQUEST_CANCELLED', status: 499 });
  });
});
