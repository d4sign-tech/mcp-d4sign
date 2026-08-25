import { describe, expect, it, vi } from 'vitest';

import { QuotaExceededError } from '../../src/d4sign/errors.js';
import { InMemoryPrivateCache, RedisPrivateCache, type Cache } from '../../src/infra/cache.js';
import { InMemoryClaimStore, RedisClaimStore, type ClaimStore } from '../../src/infra/claim-store.js';
import {
  InMemoryGenerationStore,
  RedisGenerationStore,
  type GenerationStore,
} from '../../src/infra/generation-store.js';
import { InMemoryQuotaManager, RedisQuotaManager, type QuotaManager } from '../../src/infra/quota-manager.js';
import { InMemoryRateLimiter, RedisRateLimiter, type RateLimiter } from '../../src/infra/rate-limiter.js';
import { InMemoryReplayStore, RedisReplayStore, type ReplayStore } from '../../src/infra/replay-store.js';
import { FakeRedis } from '../support/fake-redis.js';

const SCOPE = 'tenant-a:fingerprint-a:document-tags-list';

/**
 * O perfil de produção usa exclusivamente os backends Redis. Cada contrato é
 * exercitado nas duas implementações para que memória e Redis não divirjam em
 * garantias — foi exatamente essa divergência que deixou o cache distribuído
 * republicando dados obsoletos.
 */
function cacheImplementations(): { name: string; create: () => Cache }[] {
  return [
    { name: 'InMemoryPrivateCache', create: () => new InMemoryPrivateCache() },
    {
      name: 'RedisPrivateCache',
      create: () => {
        const redis = new FakeRedis();
        return new RedisPrivateCache(redis, new RedisGenerationStore(redis));
      },
    },
  ];
}

describe.each(cacheImplementations())('Cache privado — $name', ({ create }) => {
  it('deduplica leituras concorrentes idênticas', async () => {
    const cache = create();
    const loader = vi.fn(() => Promise.resolve({ value: 42 }));

    const [first, second] = await Promise.all([
      cache.getOrSet(SCOPE, 'key', 1_000, loader),
      cache.getOrSet(SCOPE, 'key', 1_000, loader),
    ]);

    expect(first).toEqual({ value: 42 });
    expect(second).toEqual({ value: 42 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('serve o valor cacheado sem reexecutar o loader', async () => {
    const cache = create();
    const loader = vi.fn(() => Promise.resolve('valor'));
    await cache.getOrSet(SCOPE, 'key', 60_000, loader);
    await expect(cache.getOrSet(SCOPE, 'key', 60_000, loader)).resolves.toBe('valor');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('não reinsere no cache uma leitura em voo invalidada por mutação concorrente', async () => {
    const cache = create();
    let resolveStale: ((value: string) => void) | undefined;
    const stale = cache.getOrSet(SCOPE, 'key', 60_000, () => new Promise<string>((resolve) => {
      resolveStale = resolve;
    }));
    await Promise.resolve();

    // Mutação concorrente invalida o escopo antes do loader resolver.
    await cache.invalidate(SCOPE);
    resolveStale?.('stale');
    await expect(stale).resolves.toBe('stale');

    const freshLoader = vi.fn(() => Promise.resolve('fresh'));
    await expect(cache.getOrSet(SCOPE, 'key', 60_000, freshLoader)).resolves.toBe('fresh');
    // Segunda leitura: se a escrita em voo tivesse vencido, veria 'stale'.
    await expect(cache.getOrSet(SCOPE, 'key', 60_000, freshLoader)).resolves.toBe('fresh');
    expect(freshLoader).toHaveBeenCalledTimes(1);
  });

  it('invalida apenas o escopo informado', async () => {
    const cache = create();
    const other = 'tenant-a:fingerprint-a:document-get';
    await cache.getOrSet(SCOPE, 'key', 60_000, () => Promise.resolve('tags'));
    await cache.getOrSet(other, 'key', 60_000, () => Promise.resolve('doc'));

    await cache.invalidate(SCOPE);

    const tagsLoader = vi.fn(() => Promise.resolve('tags-novo'));
    const docLoader = vi.fn(() => Promise.resolve('doc-novo'));
    await expect(cache.getOrSet(SCOPE, 'key', 60_000, tagsLoader)).resolves.toBe('tags-novo');
    await expect(cache.getOrSet(other, 'key', 60_000, docLoader)).resolves.toBe('doc');
    expect(docLoader).not.toHaveBeenCalled();
  });

  it('isola contas diferentes no mesmo tenant', async () => {
    const cache = create();
    await cache.getOrSet('tenant-a:conta-1:document-get', 'k', 60_000, () => Promise.resolve('conta-1'));
    await expect(
      cache.getOrSet('tenant-a:conta-2:document-get', 'k', 60_000, () => Promise.resolve('conta-2')),
    ).resolves.toBe('conta-2');
  });
});

describe('Invalidação por geração', () => {
  const stores: { name: string; create: () => GenerationStore }[] = [
    { name: 'InMemoryGenerationStore', create: () => new InMemoryGenerationStore() },
    { name: 'RedisGenerationStore', create: () => new RedisGenerationStore(new FakeRedis()) },
  ];

  it.each(stores)('$name começa em zero e avança monotonicamente', async ({ create }) => {
    const store = create();
    await expect(store.current('a')).resolves.toBe(0);
    await expect(store.bump('a')).resolves.toBe(1);
    await expect(store.bump('a')).resolves.toBe(2);
    await expect(store.current('a')).resolves.toBe(2);
    await expect(store.current('b')).resolves.toBe(0);
  });

  it('RedisGenerationStore renova o TTL a cada incremento', async () => {
    const redis = new FakeRedis();
    const store = new RedisGenerationStore(redis, 'd4sign-mcp:gen:', 60_000);
    await store.bump('conta');
    expect(redis.commands).toContain('pexpire');
    redis.advance(59_000);
    await expect(store.current('conta')).resolves.toBe(1);
    redis.advance(120_000);
    // Expirado: volta a zero, o que só reforça a invalidação.
    await expect(store.current('conta')).resolves.toBe(0);
  });
});

describe('Cota upstream', () => {
  const managers: { name: string; create: (limit: number) => QuotaManager }[] = [
    { name: 'InMemoryQuotaManager', create: (limit) => new InMemoryQuotaManager(limit, 1_000, () => 100) },
    { name: 'RedisQuotaManager', create: (limit) => new RedisQuotaManager(new FakeRedis(), limit, 1_000) },
  ];

  it.each(managers)('$name bloqueia a chamada que excede a janela', async ({ create }) => {
    const quota = create(2);
    await expect(quota.reserve('conta')).resolves.toMatchObject({ remaining: 1 });
    await expect(quota.reserve('conta')).resolves.toMatchObject({ remaining: 0 });
    await expect(quota.reserve('conta')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it.each(managers)('$name separa contas distintas', async ({ create }) => {
    const quota = create(1);
    await expect(quota.reserve('conta-a')).resolves.toMatchObject({ remaining: 0 });
    await expect(quota.reserve('conta-b')).resolves.toMatchObject({ remaining: 0 });
    await expect(quota.reserve('conta-a')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('RedisQuotaManager rejeita custo e limite inválidos antes de tocar o Redis', async () => {
    const redis = new FakeRedis();
    const quota = new RedisQuotaManager(redis, 10);
    await expect(quota.reserve('conta', 0)).rejects.toBeInstanceOf(RangeError);
    await expect(quota.reserve('conta', 1, 0)).rejects.toBeInstanceOf(RangeError);
    expect(redis.commands).toHaveLength(0);
  });

  it('RedisQuotaManager libera a cota quando a janela expira', async () => {
    const redis = new FakeRedis();
    const quota = new RedisQuotaManager(redis, 1, 1_000);
    await expect(quota.reserve('conta')).resolves.toMatchObject({ remaining: 0 });
    await expect(quota.reserve('conta')).rejects.toBeInstanceOf(QuotaExceededError);
    redis.advance(1_500);
    await expect(quota.reserve('conta')).resolves.toMatchObject({ remaining: 0 });
  });
});

describe('Rate limit de entrada', () => {
  const limiters: { name: string; create: () => RateLimiter }[] = [
    { name: 'InMemoryRateLimiter', create: () => new InMemoryRateLimiter(() => 100) },
    { name: 'RedisRateLimiter', create: () => new RedisRateLimiter(new FakeRedis()) },
  ];

  it.each(limiters)('$name bloqueia depois do limite e informa Retry-After', async ({ create }) => {
    const limiter = create();
    await expect(limiter.consume('principal', 2, 60_000)).resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(limiter.consume('principal', 2, 60_000)).resolves.toMatchObject({ allowed: true, remaining: 0 });
    const blocked = await limiter.consume('principal', 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it.each(limiters)('$name isola chaves distintas', async ({ create }) => {
    const limiter = create();
    await expect(limiter.consume('a', 1, 60_000)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume('b', 1, 60_000)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.consume('a', 1, 60_000)).resolves.toMatchObject({ allowed: false });
  });
});

describe('Anti-replay de confirmação MRTR', () => {
  const stores: { name: string; create: () => ReplayStore }[] = [
    { name: 'InMemoryReplayStore', create: () => new InMemoryReplayStore(() => 100) },
    { name: 'RedisReplayStore', create: () => new RedisReplayStore(new FakeRedis()) },
  ];

  it.each(stores)('$name consome cada flowId uma única vez', async ({ create }) => {
    const store = create();
    await expect(store.consume('flow-1', 300_000)).resolves.toBe(true);
    await expect(store.consume('flow-1', 300_000)).resolves.toBe(false);
    await expect(store.consume('flow-2', 300_000)).resolves.toBe(true);
  });

  it('RedisReplayStore resolve corrida entre réplicas com SET NX', async () => {
    const redis = new FakeRedis();
    const replicaA = new RedisReplayStore(redis);
    const replicaB = new RedisReplayStore(redis);
    const [first, second] = await Promise.all([
      replicaA.consume('flow-compartilhado', 300_000),
      replicaB.consume('flow-compartilhado', 300_000),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});

describe('Claim de uploadHandle', () => {
  const stores: { name: string; create: () => ClaimStore }[] = [
    { name: 'InMemoryClaimStore', create: () => new InMemoryClaimStore(() => 100) },
    { name: 'RedisClaimStore', create: () => new RedisClaimStore(new FakeRedis()) },
  ];

  it.each(stores)('$name concede a apenas um consumidor e devolve na liberação', async ({ create }) => {
    const store = create();
    await expect(store.acquire('handle', 30_000)).resolves.toBe(true);
    await expect(store.acquire('handle', 30_000)).resolves.toBe(false);
    await store.release('handle');
    // Liberado: o retry documentado com o mesmo handle continua possível.
    await expect(store.acquire('handle', 30_000)).resolves.toBe(true);
  });
});
