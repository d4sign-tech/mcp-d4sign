import {
  InMemoryGenerationStore,
  type GenerationStore,
} from './generation-store.js';

export interface Cache {
  /**
   * `scope` é a unidade de invalidação (conta + operação); `key` identifica os
   * argumentos dentro dela. A geração corrente do escopo entra na chave física,
   * então invalidar é um incremento O(1) e escritas em voo sob a geração antiga
   * nunca voltam a ser lidas.
   */
  getOrSet<T>(scope: string, key: string, ttlMs: number, loader: () => Promise<T>): Promise<T>;
  invalidate(scope: string): Promise<void>;
  clear(): Promise<void>;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

function physicalKey(scope: string, generation: number, key: string): string {
  return `${scope}:${generation}:${key}`;
}

export class InMemoryPrivateCache implements Cache {
  private readonly values = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly generations: GenerationStore;

  constructor(
    private readonly maxEntries = 500,
    generations: GenerationStore = new InMemoryGenerationStore(),
    private readonly now: () => number = Date.now,
  ) {
    this.generations = generations;
  }

  async getOrSet<T>(scope: string, key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const generation = await this.generations.current(scope);
    const physical = physicalKey(scope, generation, key);
    const cached = this.values.get(physical);
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.value as T;
    if (cached !== undefined) this.values.delete(physical);

    const inFlight = this.pending.get(physical);
    if (inFlight !== undefined) return inFlight as Promise<T>;

    const promise = loader()
      .then(async (value) => {
        // Só publica se ninguém invalidou o escopo enquanto o loader corria.
        if ((await this.generations.current(scope)) === generation) {
          this.evictIfNeeded();
          this.values.set(physical, { value, expiresAt: this.now() + ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(physical) === promise) this.pending.delete(physical);
      });

    this.pending.set(physical, promise);
    return promise;
  }

  async invalidate(scope: string): Promise<void> {
    await this.generations.bump(scope);
    const stalePrefix = `${scope}:`;
    for (const key of this.values.keys()) {
      if (key.startsWith(stalePrefix)) this.values.delete(key);
    }
  }

  clear(): Promise<void> {
    this.values.clear();
    this.pending.clear();
    return Promise.resolve();
  }

  private evictIfNeeded(): void {
    const now = this.now();
    for (const [key, entry] of this.values) {
      if (entry.expiresAt <= now) this.values.delete(key);
    }
    while (this.values.size >= this.maxEntries) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey === undefined) return;
      this.values.delete(oldestKey);
    }
  }
}

export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
  scan(cursor: string, options: { MATCH: string; COUNT: number }): Promise<{ cursor: string; keys: string[] }>;
  del(keys: string[]): Promise<number>;
}

export class RedisPrivateCache implements Cache {
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: RedisCacheClient,
    private readonly generations: GenerationStore,
    private readonly namespace = 'd4sign-mcp:cache:',
  ) {}

  async getOrSet<T>(scope: string, key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const generation = await this.generations.current(scope);
    const namespaced = `${this.namespace}${physicalKey(scope, generation, key)}`;
    const cached = await this.client.get(namespaced);
    if (cached !== null) return JSON.parse(cached) as T;

    const inFlight = this.pending.get(namespaced);
    if (inFlight !== undefined) return inFlight as Promise<T>;

    const promise = loader()
      .then(async (value) => {
        // Reconfere a geração: se houve invalidação durante o loader, o valor é
        // gravado sob uma geração já superada e nunca será lido.
        if ((await this.generations.current(scope)) === generation) {
          await this.client.set(namespaced, JSON.stringify(value), { PX: ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(namespaced) === promise) this.pending.delete(namespaced);
      });

    this.pending.set(namespaced, promise);
    return promise;
  }

  async invalidate(scope: string): Promise<void> {
    await this.generations.bump(scope);
  }

  async clear(): Promise<void> {
    // Reservado a operações administrativas; o caminho de mutação usa invalidate().
    let cursor = '0';
    do {
      const page = await this.client.scan(cursor, { MATCH: `${this.namespace}*`, COUNT: 100 });
      cursor = page.cursor;
      if (page.keys.length > 0) await this.client.del(page.keys);
    } while (cursor !== '0');
  }
}
