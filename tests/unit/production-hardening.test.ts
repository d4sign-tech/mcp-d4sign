import { describe, expect, it } from 'vitest';

import {
  AwsSecretsManagerCredentialProvider,
  CredentialNotConfiguredError,
  type SecretsManagerApi,
} from '../../src/auth/credential-provider.js';
import { loadConfig } from '../../src/config/env.js';
import { D4SignApiError, UploadScanPendingError } from '../../src/d4sign/errors.js';
import { InMemoryRateLimiter } from '../../src/infra/rate-limiter.js';
import { sanitizeTelemetryValue } from '../../src/infra/telemetry-sanitizer.js';
import { S3UploadStore, type S3ObjectApi } from '../../src/infra/upload-store.js';
import { toToolError } from '../../src/shared/result.js';

function awsError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

class FakeSecretsManager implements SecretsManagerApi {
  readonly values = new Map<string, string>();

  getSecretValue(name: string): Promise<string | undefined> {
    const value = this.values.get(name);
    return value === undefined ? Promise.reject(awsError('ResourceNotFoundException')) : Promise.resolve(value);
  }

  createSecret(name: string, value: string): Promise<void> {
    if (this.values.has(name)) return Promise.reject(awsError('ResourceExistsException'));
    this.values.set(name, value);
    return Promise.resolve();
  }

  putSecretValue(name: string, value: string): Promise<void> {
    if (!this.values.has(name)) return Promise.reject(awsError('ResourceNotFoundException'));
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

const baseEnv = {
  NODE_ENV: 'development',
  D4SIGN_TOKEN_API: 'local-token',
  D4SIGN_REQUESTS_PER_HOUR: '1000',
};

describe('hardening de produção', () => {
  it('mantém stdio local sem bearer e exige os backends AWS em produção', () => {
    expect(loadConfig(baseEnv).authMode).toBe('static');
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: 'production' })).toThrow('Configuração de produção incompleta');

    const production = loadConfig({
      NODE_ENV: 'production',
      MCP_PUBLIC_BASE_URL: 'https://mcp.example.com',
      MCP_AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example',
      // Cognito não emite `aud`: o vínculo é o client ID autorizado.
      OIDC_ALLOWED_CLIENT_IDS: '5abcdefghijklmnopqrstuvwxy',
      OIDC_SCOPE_PREFIX: 'd4sign-mcp',
      MCP_REQUEST_STATE_KEY: 'request-state-key-with-more-than-32-bytes',
      D4SIGN_CREDENTIAL_BACKEND: 'aws-secrets-manager',
      AWS_REGION: 'us-east-1',
      AWS_CREDENTIALS_KMS_KEY_ID: 'arn:aws:kms:us-east-1:111122223333:key/example',
      MCP_STATE_BACKEND: 'redis',
      AWS_REDIS_URL: 'rediss://redis.example:6379',
      AWS_REDIS_USERNAME: 'd4sign-mcp',
      AWS_REDIS_PASSWORD: 'redis-password-with-32-characters',
      MCP_UPLOAD_BACKEND: 's3',
      AWS_S3_BUCKET: 'd4sign-mcp-uploads-example',
      AWS_S3_REQUIRE_CLEAN_SCAN: 'true',
      D4SIGN_REQUESTS_PER_HOUR: '1000',
    });
    expect(production.d4sign.tokenApi).toBeUndefined();
    expect(production.credentialBackend).toBe('aws-secrets-manager');
    expect(production.aws?.requireCleanS3Scan).toBe(true);
    expect(production.oidc?.allowedClientIds).toEqual(['5abcdefghijklmnopqrstuvwxy']);
    expect(production.oidc?.audience).toBeUndefined();
  });

  it('exige algum vínculo de recurso no modo oidc', () => {
    // Sem `aud` e sem client ID permitido não há nada ligando o token a este
    // recurso: qualquer token do mesmo issuer seria aceito.
    expect(() => loadConfig({
      ...baseEnv,
      MCP_AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example',
    })).toThrow('OIDC_AUDIENCE');

    expect(() => loadConfig({
      ...baseEnv,
      MCP_AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example',
      OIDC_ALLOWED_CLIENT_IDS: 'client-a,client-b',
    })).not.toThrow();
  });

  it('rejeita OIDC_AUDIENCE divergente do recurso público em produção', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      MCP_PUBLIC_BASE_URL: 'https://mcp.example.com',
      MCP_AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_AUDIENCE: 'https://outro.example.com/mcp',
      MCP_REQUEST_STATE_KEY: 'request-state-key-with-more-than-32-bytes',
      D4SIGN_CREDENTIAL_BACKEND: 'aws-secrets-manager',
      AWS_REGION: 'us-east-1',
      AWS_CREDENTIALS_KMS_KEY_ID: 'arn:aws:kms:us-east-1:111122223333:key/example',
      MCP_STATE_BACKEND: 'redis',
      AWS_REDIS_URL: 'rediss://redis.example:6379',
      AWS_REDIS_USERNAME: 'd4sign-mcp',
      AWS_REDIS_PASSWORD: 'redis-password-with-32-characters',
      MCP_UPLOAD_BACKEND: 's3',
      AWS_S3_BUCKET: 'd4sign-mcp-uploads-example',
      AWS_S3_REQUIRE_CLEAN_SCAN: 'true',
      D4SIGN_REQUESTS_PER_HOUR: '1000',
    })).toThrow('OIDC_AUDIENCE');
  });

  it('rejeita MCP_BEARER_TOKEN curto e mantém stdio sem bearer', () => {
    expect(() => loadConfig({ ...baseEnv, MCP_BEARER_TOKEN: 'curto' })).toThrow();
    // stdio usa o default `static` e nunca abre porta HTTP.
    expect(loadConfig(baseEnv).mcpBearerToken).toBeUndefined();
  });

  it('isola credenciais no Secrets Manager por principal e não grava o identificador no nome', async () => {
    const secrets = new FakeSecretsManager();
    const provider = new AwsSecretsManagerCredentialProvider(secrets, {
      secretPrefix: 'd4sign-mcp/credentials',
      scope: 'principal',
    });
    const first = { principalId: 'alice@example.com', tenantId: 'tenant-a' };
    const second = { principalId: 'bob@example.com', tenantId: 'tenant-a' };
    await provider.setCredentials(first, {
      tokenApi: 'token-alice',
      environment: 'production',
      requestsPerHour: 1000,
    });

    await expect(provider.getCredentials(first)).resolves.toMatchObject({ tokenApi: 'token-alice' });
    await expect(provider.getCredentials(second)).rejects.toBeInstanceOf(CredentialNotConfiguredError);
    const secretName = [...secrets.values.keys()][0] ?? '';
    expect(secretName).not.toContain('alice');
    expect(secretName).toMatch(/^d4sign-mcp\/credentials\/[a-f0-9]{40}$/u);
    await provider.deleteCredentials(first);
    await expect(provider.getCredentials(first)).rejects.toBeInstanceOf(CredentialNotConfiguredError);
  });

  it('aplica rate limit independente da cota D4Sign', async () => {
    const limiter = new InMemoryRateLimiter(() => 100);
    await expect(limiter.consume('principal:mcp', 2, 60_000)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter.consume('principal:mcp', 2, 60_000)).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(limiter.consume('principal:mcp', 2, 60_000)).resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it('bloqueia o consumo do S3 até o GuardDuty confirmar resultado limpo', async () => {
    let bytes = new Uint8Array();
    let metadata: Record<string, string> = {};
    let tags: Record<string, string> = {};
    let deleted = false;
    const s3: S3ObjectApi = {
      ensureBucket: () => Promise.resolve(),
      putObject: (input) => {
        bytes = Uint8Array.from(input.bytes);
        metadata = input.metadata;
        tags = {};
        deleted = false;
        return Promise.resolve();
      },
      headObject: () => Promise.resolve({ metadata, contentLength: bytes.byteLength, versionId: 'v1' }),
      getObjectTags: () => Promise.resolve(tags),
      getObjectBytes: () => Promise.resolve(Uint8Array.from(bytes)),
      deleteObject: (_bucket, _key, versionId) => {
        deleted = versionId !== undefined;
        return Promise.resolve();
      },
    };
    const store = new S3UploadStore(s3, 'test-bucket', 'uploads', 60_000, 10_000, () => 1_000, true);
    const auth = { principalId: 'principal-a', tenantId: 'tenant-a' };
    const file = { fileName: 'contrato.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.7') };
    const receipt = await store.put(auth, file);

    await expect(store.get(auth, receipt.uploadHandle)).rejects.toBeInstanceOf(UploadScanPendingError);
    tags.GuardDutyMalwareScanStatus = 'NO_THREATS_FOUND';
    await expect(store.get(auth, receipt.uploadHandle)).resolves.toMatchObject({ fileName: 'contrato.pdf' });

    tags.GuardDutyMalwareScanStatus = 'THREATS_FOUND';
    await expect(store.get(auth, receipt.uploadHandle)).rejects.toThrow('rejeitado pela verificação antimalware');
    expect(deleted).toBe(true);
  });

  it('remove segredos de objetos, URLs, bearer, JWT e referências circulares', () => {
    const value: Record<string, unknown> = {
      authorization: 'Bearer segredo',
      url: 'https://example.com/?tokenAPI=segredo&cryptKey=chave',
      nested: { password: 'senha' },
    };
    value.self = value;
    expect(sanitizeTelemetryValue(value)).toEqual({
      authorization: '[REDACTED]',
      url: 'https://example.com/?tokenAPI=[REDACTED]&cryptKey=[REDACTED]',
      nested: { password: '[REDACTED]' },
      self: '[Circular]',
    });
  });

  it('retorna erro semântico acionável sem repassar o body upstream', () => {
    const result = toToolError(new D4SignApiError('A D4Sign está temporariamente indisponível.', 503, 'D4SIGN_UNAVAILABLE', true, 'upstream-123'));
    const content = result.content[0];
    if (content?.type !== 'text') throw new Error('Conteúdo de erro inesperado.');
    expect(JSON.parse(content.text)).toEqual({
      version: '1',
      category: 'upstream_transient',
      code: 'D4SIGN_UNAVAILABLE',
      retryable: true,
      message: 'A D4Sign está temporariamente indisponível.',
      suggestedAction: 'wait_and_retry',
      upstreamRequestId: 'upstream-123',
    });
  });
});
