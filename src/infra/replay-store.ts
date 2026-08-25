export interface ReplayStore {
  consume(key: string, ttlMs: number): Promise<boolean>;
}

export class InMemoryReplayStore implements ReplayStore {
  private readonly used = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, ttlMs: number): Promise<boolean> {
    const now = this.now();
    for (const [usedKey, expiresAt] of this.used) {
      if (expiresAt <= now) this.used.delete(usedKey);
    }
    if (this.used.has(key)) return Promise.resolve(false);
    this.used.set(key, now + ttlMs);
    return Promise.resolve(true);
  }
}

export interface RedisReplayClient {
  set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
}

export class RedisReplayStore implements ReplayStore {
  constructor(
    private readonly client: RedisReplayClient,
    private readonly namespace = 'd4sign-mcp:replay:',
  ) {}

  async consume(key: string, ttlMs: number): Promise<boolean> {
    return (await this.client.set(`${this.namespace}${key}`, '1', { NX: true, PX: ttlMs })) === 'OK';
  }
}
