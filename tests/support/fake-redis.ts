import { RATE_LIMIT_SCRIPT } from '../../src/infra/rate-limiter.js';
import { RESERVE_SCRIPT } from '../../src/infra/quota-manager.js';

interface Entry {
  value: string;
  expiresAt: number | undefined;
}

/**
 * Redis em memória suficiente para exercitar os backends distribuídos.
 *
 * Os scripts Lua são reconhecidos por identidade textual: qualquer alteração
 * neles quebra este fake de propósito, forçando a revisão do teste em vez de
 * deixar o script de produção sem cobertura.
 */
export class FakeRedis {
  private readonly store = new Map<string, Entry>();
  readonly commands: string[] = [];

  constructor(private now: () => number = () => 1_000) {}

  advance(ms: number): void {
    const base = this.now();
    this.now = () => base + ms;
  }

  keys(): string[] {
    this.expire();
    return [...this.store.keys()];
  }

  raw(key: string): string | undefined {
    this.expire();
    return this.store.get(key)?.value;
  }

  forget(key: string): void {
    this.store.delete(key);
  }

  private expire(): void {
    const now = this.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.store.delete(key);
    }
  }

  get(key: string): Promise<string | null> {
    this.commands.push('get');
    this.expire();
    return Promise.resolve(this.store.get(key)?.value ?? null);
  }

  set(
    key: string,
    value: string,
    options?: { PX?: number; NX?: true },
  ): Promise<string | null> {
    this.commands.push('set');
    this.expire();
    if (options?.NX === true && this.store.has(key)) return Promise.resolve(null);
    this.store.set(key, {
      value,
      expiresAt: options?.PX === undefined ? undefined : this.now() + options.PX,
    });
    return Promise.resolve('OK');
  }

  incr(key: string): Promise<number> {
    this.commands.push('incr');
    this.expire();
    const next = Number(this.store.get(key)?.value ?? '0') + 1;
    this.store.set(key, { value: String(next), expiresAt: this.store.get(key)?.expiresAt });
    return Promise.resolve(next);
  }

  pExpire(key: string, ms: number): Promise<boolean> {
    this.commands.push('pexpire');
    const entry = this.store.get(key);
    if (entry === undefined) return Promise.resolve(false);
    entry.expiresAt = this.now() + ms;
    return Promise.resolve(true);
  }

  del(keys: string[]): Promise<number> {
    this.commands.push('del');
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return Promise.resolve(removed);
  }

  scan(cursor: string, options: { MATCH: string; COUNT: number }): Promise<{ cursor: string; keys: string[] }> {
    this.commands.push('scan');
    this.expire();
    const pattern = new RegExp(`^${options.MATCH.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')}$`, 'u');
    return Promise.resolve({ cursor: '0', keys: [...this.store.keys()].filter((key) => pattern.test(key)) });
  }

  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    this.commands.push('eval');
    this.expire();
    const key = options.keys[0] ?? '';
    if (script === RESERVE_SCRIPT) {
      const [limitText, costText, windowText] = options.arguments;
      const limit = Number(limitText);
      const cost = Number(costText);
      const windowMs = Number(windowText);
      const current = this.store.get(key);
      if (current === undefined) {
        this.store.set(key, { value: String(cost), expiresAt: this.now() + windowMs });
        return Promise.resolve([cost, windowMs]);
      }
      const ttl = current.expiresAt === undefined ? -1 : current.expiresAt - this.now();
      const next = Number(current.value) + cost;
      if (next > limit) return Promise.resolve([-1, ttl]);
      current.value = String(next);
      return Promise.resolve([next, ttl]);
    }
    if (script === RATE_LIMIT_SCRIPT) {
      const windowMs = Number(options.arguments[1]);
      const current = this.store.get(key);
      const next = Number(current?.value ?? '0') + 1;
      if (current === undefined) {
        this.store.set(key, { value: String(next), expiresAt: this.now() + windowMs });
      } else {
        current.value = String(next);
      }
      const entry = this.store.get(key);
      const ttl = entry?.expiresAt === undefined ? -1 : entry.expiresAt - this.now();
      return Promise.resolve([next, ttl]);
    }
    throw new Error('Script Lua desconhecido no FakeRedis; atualize o teste junto com o script.');
  }
}
