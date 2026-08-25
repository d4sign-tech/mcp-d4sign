import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;

export function normalizeRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate !== undefined && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

export function runWithRequestContext<T>(requestId: string, operation: () => Promise<T>): Promise<T> {
  return storage.run({ requestId }, operation);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
