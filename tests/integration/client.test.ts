import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { D4SignApiError } from '../../src/d4sign/errors.js';
import { D4SignClient } from '../../src/d4sign/client.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';

const logger = pino({ enabled: false });

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

function createClient(fetchImpl: typeof fetch, cryptKey?: string): D4SignClient {
  return new D4SignClient({
    credentials: {
      tokenApi: 'token-api-de-teste',
      environment: 'sandbox',
      ...(cryptKey === undefined ? {} : { cryptKey }),
    },
    quotaManager: new InMemoryQuotaManager(10),
    logger,
    timeoutMs: 1_000,
    maxResponseBytes: 10_000,
    fetchImpl,
  });
}

describe('D4SignClient', () => {
  it('usa host fixo, adiciona credenciais internamente e não segue redirects', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
    );
    const client = createClient(fetchMock, 'crypt-de-teste');

    await expect(
      client.request({ method: 'GET', path: '/documents', query: { pg: 2 } }),
    ).resolves.toEqual({ ok: true });

    const firstCall = fetchMock.mock.calls.at(0);
    if (firstCall === undefined) throw new Error('fetch não foi chamado');
    const [input, init] = firstCall;
    const url = requestUrl(input);
    expect(url.origin).toBe('https://sandbox.d4sign.com.br');
    expect(url.pathname).toBe('/api/v1/documents');
    expect(url.searchParams.get('pg')).toBe('2');
    expect(url.searchParams.get('tokenAPI')).toBe('token-api-de-teste');
    expect(url.searchParams.get('cryptKey')).toBe('crypt-de-teste');
    expect(init?.redirect).toBe('error');
  });

  it('omite cryptKey quando a conta não o utiliza', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status: 200 })));
    const client = createClient(fetchMock);
    await client.request({ method: 'GET', path: '/safes' });

    const firstCall = fetchMock.mock.calls.at(0);
    if (firstCall === undefined) throw new Error('fetch não foi chamado');
    const [input] = firstCall;
    expect(requestUrl(input).searchParams.has('cryptKey')).toBe(false);
  });

  it('mapeia erro HTTP sem incluir URL autenticada', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ message: 'negado' }), { status: 403 })),
    );
    const client = createClient(fetchMock, 'crypt-de-teste');

    const error = await client.request({ method: 'GET', path: '/safes' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(D4SignApiError);
    expect(error).toMatchObject({ status: 403, code: 'D4SIGN_FORBIDDEN', retryable: false });
    expect(String(error)).not.toContain('token-api-de-teste');
    expect(String(error)).not.toContain('crypt-de-teste');
  });

  it('repete uma única vez somente leitura transitória', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const client = new D4SignClient({
      credentials: { tokenApi: 'token-api-de-teste', environment: 'sandbox' },
      quotaManager: new InMemoryQuotaManager(10),
      logger,
      timeoutMs: 1_000,
      maxResponseBytes: 10_000,
      fetchImpl: fetchMock,
      retryBaseDelayMs: 1,
    });
    await expect(client.request({ method: 'GET', path: '/safes' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('não repete escrita mesmo em falha transitória', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}', { status: 503 })));
    const client = createClient(fetchMock);
    await expect(client.request({ method: 'POST', path: '/templates' })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
