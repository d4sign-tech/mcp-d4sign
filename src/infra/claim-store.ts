/**
 * Reserva exclusiva e temporária de um recurso, com liberação explícita.
 *
 * Diferente do `ReplayStore`, um claim pode ser devolvido: um upload que falhou
 * na D4Sign precisa poder ser reenviado com o mesmo handle, enquanto duas
 * chamadas simultâneas com o mesmo handle não podem criar dois documentos.
 */
export interface ClaimStore {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export class InMemoryClaimStore implements ClaimStore {
  private readonly claims = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = this.now();
    for (const [claimed, expiresAt] of this.claims) {
      if (expiresAt <= now) this.claims.delete(claimed);
    }
    const existing = this.claims.get(key);
    if (existing !== undefined && existing > now) return Promise.resolve(false);
    this.claims.set(key, now + ttlMs);
    return Promise.resolve(true);
  }

  release(key: string): Promise<void> {
    this.claims.delete(key);
    return Promise.resolve();
  }
}

export interface RedisClaimClient {
  set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
  del(keys: string[]): Promise<number>;
}

export class RedisClaimStore implements ClaimStore {
  constructor(
    private readonly client: RedisClaimClient,
    private readonly namespace = 'd4sign-mcp:claim:',
  ) {}

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    return (await this.client.set(`${this.namespace}${key}`, '1', { NX: true, PX: ttlMs })) === 'OK';
  }

  async release(key: string): Promise<void> {
    await this.client.del([`${this.namespace}${key}`]);
  }
}
