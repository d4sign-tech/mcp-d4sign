import { QuotaExceededError } from '../d4sign/errors.js';

export interface QuotaReservation {
  remaining: number;
  resetsAt: Date;
}

export interface QuotaManager {
  reserve(key: string, cost?: number, limit?: number): Promise<QuotaReservation>;
}

interface WindowState {
  used: number;
  startsAt: number;
}

export class InMemoryQuotaManager implements QuotaManager {
  private readonly windows = new Map<string, WindowState>();

  constructor(
    private readonly defaultLimit: number,
    private readonly windowMs = 60 * 60 * 1_000,
    private readonly now: () => number = Date.now,
  ) {}

  reserve(key: string, cost = 1, limit = this.defaultLimit): Promise<QuotaReservation> {
    return Promise.resolve().then(() => this.reserveNow(key, cost, limit));
  }

  private reserveNow(key: string, cost: number, limit: number): QuotaReservation {
    if (!Number.isInteger(cost) || cost < 1) throw new RangeError('O custo da cota deve ser um inteiro positivo.');
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('O limite da cota deve ser um inteiro positivo.');

    const now = this.now();
    const current = this.windows.get(key);
    const state =
      current === undefined || now >= current.startsAt + this.windowMs
        ? { used: 0, startsAt: now }
        : current;
    const resetsAt = new Date(state.startsAt + this.windowMs);

    if (state.used + cost > limit) throw new QuotaExceededError(resetsAt);

    state.used += cost;
    this.windows.set(key, state);
    return { remaining: limit - state.used, resetsAt };
  }
}

export interface RedisQuotaClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

export const RESERVE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return {tonumber(ARGV[2]), tonumber(ARGV[3])}
end
local next = tonumber(current) + tonumber(ARGV[2])
local ttl = redis.call('PTTL', KEYS[1])
if next > tonumber(ARGV[1]) then return {-1, ttl} end
redis.call('INCRBY', KEYS[1], ARGV[2])
return {next, ttl}
`;

export class RedisQuotaManager implements QuotaManager {
  constructor(
    private readonly client: RedisQuotaClient,
    private readonly defaultLimit: number,
    private readonly windowMs = 60 * 60_000,
    private readonly namespace = 'd4sign-mcp:quota:',
  ) {}

  async reserve(key: string, cost = 1, limit = this.defaultLimit): Promise<QuotaReservation> {
    if (!Number.isInteger(cost) || cost < 1 || !Number.isInteger(limit) || limit < 1) {
      throw new RangeError('Custo e limite da cota devem ser inteiros positivos.');
    }
    const result = await this.client.eval(RESERVE_SCRIPT, {
      keys: [`${this.namespace}${key}`],
      arguments: [String(limit), String(cost), String(this.windowMs)],
    });
    if (!Array.isArray(result) || result.length < 2) throw new Error('Resposta Redis inválida ao reservar cota.');
    const used = Number(result[0]);
    const ttl = Math.max(0, Number(result[1]));
    const resetsAt = new Date(Date.now() + ttl);
    if (used < 0) throw new QuotaExceededError(resetsAt);
    return { remaining: Math.max(0, limit - used), resetsAt };
  }
}
