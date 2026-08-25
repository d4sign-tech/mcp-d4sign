export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

interface WindowState {
  used: number;
  startsAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, WindowState>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.now();
    const current = this.windows.get(key);
    const state = current === undefined || now >= current.startsAt + windowMs
      ? { used: 0, startsAt: now }
      : current;
    const retryAfterSeconds = Math.max(1, Math.ceil((state.startsAt + windowMs - now) / 1_000));
    if (state.used >= limit) {
      return Promise.resolve({ allowed: false, remaining: 0, retryAfterSeconds });
    }
    state.used += 1;
    this.windows.set(key, state);
    return Promise.resolve({ allowed: true, remaining: limit - state.used, retryAfterSeconds });
  }
}

export interface RedisRateLimitClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly client: RedisRateLimitClient,
    private readonly namespace = 'd4sign-mcp:rate:',
  ) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const result = await this.client.eval(RATE_LIMIT_SCRIPT, {
      keys: [`${this.namespace}${key}`],
      arguments: [String(limit), String(windowMs)],
    });
    if (!Array.isArray(result) || result.length < 2) throw new Error('Resposta Redis inválida no rate limit.');
    const used = Number(result[0]);
    const retryAfterSeconds = Math.max(1, Math.ceil(Number(result[1]) / 1_000));
    return { allowed: used <= limit, remaining: Math.max(0, limit - used), retryAfterSeconds };
  }
}
