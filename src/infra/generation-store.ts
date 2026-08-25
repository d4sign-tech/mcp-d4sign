/**
 * Contador monotônico compartilhado, usado para invalidação distribuída sem
 * varredura de keyspace.
 *
 * Quem invalida apenas incrementa a geração; quem lê compõe a geração corrente
 * na chave. Uma escrita iniciada antes da invalidação grava sob a geração
 * antiga, que já é inalcançável — é isso que impede uma leitura em voo de
 * republicar dados obsoletos depois de uma mutação.
 */
export interface GenerationStore {
  current(key: string): Promise<number>;
  bump(key: string): Promise<number>;
}

export class InMemoryGenerationStore implements GenerationStore {
  private readonly generations = new Map<string, number>();

  constructor(private readonly maxEntries = 5_000) {}

  current(key: string): Promise<number> {
    return Promise.resolve(this.generations.get(key) ?? 0);
  }

  bump(key: string): Promise<number> {
    const next = (this.generations.get(key) ?? 0) + 1;
    if (!this.generations.has(key)) this.evictIfNeeded();
    this.generations.set(key, next);
    return Promise.resolve(next);
  }

  private evictIfNeeded(): void {
    while (this.generations.size >= this.maxEntries) {
      const oldest = this.generations.keys().next().value;
      if (oldest === undefined) return;
      this.generations.delete(oldest);
    }
  }
}

export interface RedisGenerationClient {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  pExpire(key: string, ms: number): Promise<unknown>;
}

export class RedisGenerationStore implements GenerationStore {
  constructor(
    private readonly client: RedisGenerationClient,
    private readonly namespace = 'd4sign-mcp:gen:',
    private readonly ttlMs = 24 * 60 * 60_000,
  ) {}

  async current(key: string): Promise<number> {
    const raw = await this.client.get(`${this.namespace}${key}`);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  async bump(key: string): Promise<number> {
    const namespaced = `${this.namespace}${key}`;
    const next = await this.client.incr(namespaced);
    // A geração precisa sobreviver a qualquer entrada de cache que a referencie.
    await this.client.pExpire(namespaced, this.ttlMs);
    return next;
  }
}
