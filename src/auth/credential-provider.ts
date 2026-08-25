import { createHash } from 'node:crypto';

import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  RestoreSecretCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { z } from 'zod/v4';

import type { AuthContext } from './auth-context.js';
import type { D4SignEnvironment } from '../config/types.js';
import { InMemoryGenerationStore, type GenerationStore } from '../infra/generation-store.js';

export interface D4SignCredentials {
  tokenApi: string;
  cryptKey?: string;
  environment: D4SignEnvironment;
  accountId?: string;
  requestsPerHour?: number;
}

export interface CredentialProvider {
  getCredentials(context: AuthContext): Promise<D4SignCredentials>;
}

export interface WritableCredentialProvider extends CredentialProvider {
  setCredentials(context: AuthContext, credentials: D4SignCredentials): Promise<void>;
  deleteCredentials(context: AuthContext): Promise<void>;
}

export class EnvironmentCredentialProvider implements CredentialProvider {
  constructor(private readonly credentials: D4SignCredentials) {}

  getCredentials(): Promise<D4SignCredentials> {
    return Promise.resolve(this.credentials);
  }
}

export class MockCredentialProvider implements CredentialProvider {
  constructor(private readonly credentials: D4SignCredentials) {}

  getCredentials(): Promise<D4SignCredentials> {
    return Promise.resolve(this.credentials);
  }
}

export interface SecretsManagerApi {
  getSecretValue(name: string): Promise<string | undefined>;
  createSecret(name: string, value: string, kmsKeyId?: string): Promise<void>;
  putSecretValue(name: string, value: string): Promise<void>;
  deleteSecret(name: string): Promise<void>;
  restoreSecret(name: string): Promise<void>;
}

export class AwsSdkSecretsManagerApi implements SecretsManagerApi {
  constructor(private readonly client: SecretsManagerClient) {}

  async getSecretValue(name: string): Promise<string | undefined> {
    const result = await this.client.send(new GetSecretValueCommand({ SecretId: name }));
    return result.SecretString;
  }

  async createSecret(name: string, value: string, kmsKeyId?: string): Promise<void> {
    await this.client.send(new CreateSecretCommand({
      Name: name,
      SecretString: value,
      Description: 'Credenciais D4Sign gerenciadas pelo MCP',
      Tags: [
        { Key: 'managed-by', Value: 'd4sign-mcp' },
        { Key: 'schema-version', Value: '1' },
      ],
      ...(kmsKeyId === undefined ? {} : { KmsKeyId: kmsKeyId }),
    }));
  }

  async putSecretValue(name: string, value: string): Promise<void> {
    await this.client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
  }

  async deleteSecret(name: string): Promise<void> {
    await this.client.send(new DeleteSecretCommand({ SecretId: name, RecoveryWindowInDays: 7 }));
  }

  async restoreSecret(name: string): Promise<void> {
    await this.client.send(new RestoreSecretCommand({ SecretId: name }));
  }
}

const StoredCredentialsSchema = z
  .object({
    tokenApi: z.string().trim().min(1),
    cryptKey: z.string().trim().min(1).optional(),
    environment: z.enum(['sandbox', 'production']),
    accountId: z.string().trim().min(1).optional(),
    requestsPerHour: z.number().int().min(1).max(1_000_000),
  })
  .strict();

export class CredentialNotConfiguredError extends Error {
  constructor() {
    super('As credenciais D4Sign deste principal ainda não foram cadastradas.');
    this.name = 'CredentialNotConfiguredError';
  }
}

interface CachedCredential {
  value: D4SignCredentials;
  expiresAt: number;
  generation: number;
}

function awsErrorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : undefined;
}

export class AwsSecretsManagerCredentialProvider implements WritableCredentialProvider {
  private readonly cache = new Map<string, CachedCredential>();
  private readonly pending = new Map<string, Promise<D4SignCredentials>>();
  private readonly generations: GenerationStore;

  constructor(
    private readonly client: SecretsManagerApi,
    private readonly options: {
      secretPrefix: string;
      scope: 'principal' | 'tenant';
      kmsKeyId?: string;
      cacheTtlMs?: number;
      now?: () => number;
      generations?: GenerationStore;
    },
  ) {
    this.generations = options.generations ?? new InMemoryGenerationStore();
  }

  async getCredentials(context: AuthContext): Promise<D4SignCredentials> {
    const name = this.secretName(context);
    const generation = await this.generations.current(name);
    const now = (this.options.now ?? Date.now)();
    const cached = this.cache.get(name);
    // Uma rotação ou revogação em qualquer réplica incrementa a geração; o cache
    // local só é válido enquanto refletir a geração corrente.
    if (cached !== undefined && cached.expiresAt > now && cached.generation === generation) {
      return cached.value;
    }
    if (cached !== undefined) this.cache.delete(name);

    const inFlight = this.pending.get(name);
    if (inFlight !== undefined) return inFlight;

    const load = this.load(name, generation).finally(() => this.pending.delete(name));
    this.pending.set(name, load);
    return load;
  }

  async setCredentials(context: AuthContext, credentials: D4SignCredentials): Promise<void> {
    const parsed = StoredCredentialsSchema.parse(credentials);
    const name = this.secretName(context);
    const value = JSON.stringify(parsed);
    // Incrementa ANTES da escrita: um load em voo resolve sob geração superada e
    // não recacheia o valor antigo. Incrementa de novo depois para cobrir loads
    // iniciados durante a escrita.
    await this.invalidate(name);
    try {
      await this.write(name, value);
    } finally {
      await this.invalidate(name);
    }
  }

  async deleteCredentials(context: AuthContext): Promise<void> {
    const name = this.secretName(context);
    await this.invalidate(name);
    try {
      await this.client.deleteSecret(name);
    } catch (error) {
      if (awsErrorName(error) !== 'ResourceNotFoundException') throw error;
    } finally {
      await this.invalidate(name);
    }
  }

  private async write(name: string, value: string): Promise<void> {
    try {
      await this.client.putSecretValue(name, value);
    } catch (error) {
      if (awsErrorName(error) === 'ResourceNotFoundException') {
        try {
          await this.client.createSecret(name, value, this.options.kmsKeyId);
        } catch (createError) {
          if (awsErrorName(createError) !== 'ResourceExistsException') throw createError;
          try {
            await this.client.putSecretValue(name, value);
          } catch (putError) {
            if (awsErrorName(putError) !== 'InvalidRequestException') throw putError;
            await this.client.restoreSecret(name);
            await this.client.putSecretValue(name, value);
          }
        }
      } else if (awsErrorName(error) === 'InvalidRequestException') {
        await this.client.restoreSecret(name);
        await this.client.putSecretValue(name, value);
      } else {
        throw error;
      }
    }
  }

  private async invalidate(name: string): Promise<void> {
    this.cache.delete(name);
    await this.generations.bump(name);
  }

  private async load(name: string, generation: number): Promise<D4SignCredentials> {
    let secret: string | undefined;
    try {
      secret = await this.client.getSecretValue(name);
    } catch (error) {
      if (awsErrorName(error) === 'ResourceNotFoundException' || awsErrorName(error) === 'InvalidRequestException') {
        throw new CredentialNotConfiguredError();
      }
      throw error;
    }
    if (secret === undefined) throw new CredentialNotConfiguredError();
    const parsed = StoredCredentialsSchema.parse(JSON.parse(secret) as unknown);
    const value: D4SignCredentials = {
      tokenApi: parsed.tokenApi,
      environment: parsed.environment,
      requestsPerHour: parsed.requestsPerHour,
      ...(parsed.cryptKey === undefined ? {} : { cryptKey: parsed.cryptKey }),
      ...(parsed.accountId === undefined ? {} : { accountId: parsed.accountId }),
    };
    if ((await this.generations.current(name)) === generation) {
      this.cache.set(name, {
        value,
        expiresAt: (this.options.now ?? Date.now)() + (this.options.cacheTtlMs ?? 30_000),
        generation,
      });
    }
    return value;
  }

  private secretName(context: AuthContext): string {
    const identity = this.options.scope === 'principal' ? context.principalId : context.tenantId;
    const digest = createHash('sha256').update(identity).digest('hex').slice(0, 40);
    const prefix = this.options.secretPrefix.replace(/[^a-zA-Z0-9/_+=.@-]/gu, '-').replace(/\/+$/u, '').slice(0, 460);
    return `${prefix}/${digest}`;
  }
}
