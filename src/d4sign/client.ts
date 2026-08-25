import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { D4SignCredentials } from '../auth/credential-provider.js';
import type { AppLogger } from '../infra/logger.js';
import type { QuotaManager } from '../infra/quota-manager.js';
import {
  D4SignApiError,
  ResponseTooLargeError,
} from './errors.js';

export interface D4SignRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
}

export interface D4SignClientOptions {
  credentials: D4SignCredentials;
  quotaManager: QuotaManager;
  logger: AppLogger;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
  retryLimit?: number;
  retryBaseDelayMs?: number;
}

const BASE_URLS = {
  production: 'https://secure.d4sign.com.br/api/v1/',
  sandbox: 'https://sandbox.d4sign.com.br/api/v1/',
} as const;

export function credentialFingerprint(credentials: D4SignCredentials): string {
  return createHash('sha256')
    .update(credentials.environment)
    .update('\0')
    .update(credentials.accountId ?? '')
    .update('\0')
    .update(credentials.tokenApi)
    .digest('hex');
}

function mapStatus(status: number): { code: string; message: string; retryable: boolean } {
  switch (status) {
    case 400:
      return { code: 'D4SIGN_BAD_REQUEST', message: 'A D4Sign rejeitou os parâmetros da operação.', retryable: false };
    case 401:
      return { code: 'D4SIGN_UNAUTHORIZED', message: 'As credenciais D4Sign estão ausentes ou inválidas.', retryable: false };
    case 403:
      return { code: 'D4SIGN_FORBIDDEN', message: 'A conta não possui permissão, plano ou API habilitada para a operação.', retryable: false };
    case 404:
      return { code: 'D4SIGN_NOT_FOUND', message: 'O recurso D4Sign informado não foi encontrado.', retryable: false };
    case 409:
      return { code: 'D4SIGN_CONFLICT', message: 'O recurso D4Sign está em um estado incompatível com a operação.', retryable: false };
    case 413:
      return { code: 'D4SIGN_TOO_LARGE', message: 'O conteúdo excede o limite aceito pela D4Sign.', retryable: false };
    case 415:
      return { code: 'D4SIGN_UNSUPPORTED_MEDIA', message: 'O formato enviado não é aceito pela D4Sign.', retryable: false };
    case 429:
      return { code: 'D4SIGN_RATE_LIMITED', message: 'A cota da API D4Sign foi excedida.', retryable: false };
    case 503:
      return { code: 'D4SIGN_UNAVAILABLE', message: 'A D4Sign está temporariamente indisponível.', retryable: true };
    default:
      return status >= 500
        ? { code: 'D4SIGN_UNAVAILABLE', message: 'A D4Sign está temporariamente indisponível.', retryable: true }
        : { code: 'D4SIGN_HTTP_ERROR', message: 'A D4Sign não conseguiu concluir a operação.', retryable: false };
  }
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    await response.body?.cancel();
    throw new ResponseTooLargeError();
  }
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ResponseTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(raw: string): unknown {
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Converte `Retry-After` (segundos ou data HTTP) em segundos, para que o erro
 * semântico informe ao agente quanto esperar em vez de deixá-lo adivinhar.
 */
export function parseRetryAfterSeconds(header: string | null, now: () => number = Date.now): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) && seconds >= 0 ? Math.min(seconds, 86_400) : undefined;
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.min(86_400, Math.max(0, Math.ceil((timestamp - now()) / 1_000)));
}

function safeRoute(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, '{uuid}')
    .replace(/\/[0-9]+(?=\/|$)/gu, '/{id}');
}

export class D4SignClient {
  private readonly fetchImpl: typeof fetch;
  private readonly fingerprint: string;

  constructor(private readonly options: D4SignClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.fingerprint = credentialFingerprint(options.credentials);
  }

  get accountFingerprint(): string {
    return this.fingerprint;
  }

  async request(request: D4SignRequest): Promise<unknown> {
    if (request.body !== undefined && request.formData !== undefined) {
      throw new TypeError('Uma requisição D4Sign não pode combinar JSON e multipart.');
    }
    const url = new URL(request.path.replace(/^\//, ''), BASE_URLS[this.options.credentials.environment]);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('tokenAPI', this.options.credentials.tokenApi);
    if (this.options.credentials.cryptKey !== undefined) {
      url.searchParams.set('cryptKey', this.options.credentials.cryptKey);
    }

    const retryLimit = request.method === 'GET' ? (this.options.retryLimit ?? 1) : 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.executeAttempt(request, url, attempt);
      } catch (error) {
        const retryable = error instanceof D4SignApiError && error.retryable;
        if (!retryable || attempt >= retryLimit || request.signal?.aborted === true) throw error;
        const base = this.options.retryBaseDelayMs ?? 200;
        const jitter = Math.floor(Math.random() * Math.max(1, base));
        try {
          await delay(base * 2 ** attempt + jitter, undefined, { signal: request.signal });
        } catch {
          // Cancelamento durante o backoff é cancelamento, não erro interno.
          throw new D4SignApiError('A requisição foi cancelada.', 499, 'REQUEST_CANCELLED', false);
        }
      }
    }
  }

  private async executeAttempt(request: D4SignRequest, url: URL, attempt: number): Promise<unknown> {
    await this.options.quotaManager.reserve(
      this.fingerprint,
      1,
      this.options.credentials.requestsPerHour,
    );
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    const signal = request.signal === undefined ? timeoutSignal : AbortSignal.any([request.signal, timeoutSignal]);
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl(url, {
        method: request.method,
        headers: {
          Accept: 'application/json',
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(request.formData !== undefined
          ? { body: request.formData }
          : request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body) }),
        signal,
        redirect: 'error',
      });
      const raw = await readBody(response, this.options.maxResponseBytes);
      const parsed = parseJson(raw);
      this.options.logger.info({
        operation: 'd4sign_request',
        method: request.method,
        route: safeRoute(request.path),
        upstreamStatus: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        attempt,
      }, 'Requisição D4Sign concluída');
      if (!response.ok) {
        const mapped = mapStatus(response.status);
        throw new D4SignApiError(
          mapped.message,
          response.status,
          mapped.code,
          mapped.retryable,
          response.headers.get('x-request-id') ?? undefined,
          parseRetryAfterSeconds(response.headers.get('retry-after')),
        );
      }
      if (raw.length > 0 && parsed === undefined) {
        throw new D4SignApiError('A D4Sign retornou JSON inválido.', 502, 'D4SIGN_INVALID_JSON', false);
      }
      return parsed;
    } catch (error) {
      if (error instanceof D4SignApiError || error instanceof ResponseTooLargeError) throw error;
      if (request.signal?.aborted === true) {
        throw new D4SignApiError('A requisição foi cancelada.', 499, 'REQUEST_CANCELLED', false);
      }
      if (timeoutSignal.aborted) {
        throw new D4SignApiError('A D4Sign excedeu o tempo limite de resposta.', 504, 'D4SIGN_TIMEOUT', true);
      }
      throw new D4SignApiError('Falha de rede ao acessar a D4Sign.', 503, 'D4SIGN_NETWORK_ERROR', true);
    }
  }
}
