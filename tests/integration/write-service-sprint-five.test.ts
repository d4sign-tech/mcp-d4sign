import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { D4SignWriteService } from '../../src/services/d4sign-write-service.js';

const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const auth = { principalId: 'test-user', tenantId: 'test-tenant' };
const email = 'pessoa@example.com';
const keySigner = 'signer-key-1';

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

describe('D4SignWriteService — Sprint 5', () => {
  it('executa exatamente os cinco contratos sensíveis, sem registrar dados pessoais', async () => {
    const logRecords: Record<string, unknown>[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logRecords.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        callback();
      },
    });
    const logger = pino({ level: 'info' }, destination);
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const pathname = requestUrl(input).pathname;
      const message = pathname.endsWith('/sendtosigner')
        ? 'File sent to successfully signing'
        : pathname === '/api/v1/users/block'
          ? `User ${email} was blocked`
          : 'Message sent';
      return Promise.resolve(new Response(JSON.stringify({ message }), { status: 200 }));
    });
    const cache = new InMemoryPrivateCache();
    const invalidate = vi.spyOn(cache, 'invalidate');
    const service = new D4SignWriteService({
      credentialProvider: new MockCredentialProvider({ tokenApi: 'token-de-teste', environment: 'sandbox' }),
      cache,
      quotaManager: new InMemoryQuotaManager(10),
      logger,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      fetchImpl: fetchMock,
    });

    await expect(
      service.sendDocumentForSignature(auth, {
        documentUuid,
        notifySigners: true,
        workflow: 'ordered',
        message: 'Assine o contrato',
        signLimitDate: '31-12-27',
      }),
    ).resolves.toMatchObject({ success: true, workflow: 'ordered', notifySigners: true });
    await expect(service.cancelDocument(auth, { documentUuid, comment: 'Encerrado' })).resolves.toEqual({
      success: true,
      documentUuid,
    });
    await expect(
      service.resendDocumentSignatureLink(auth, { documentUuid, email, keySigner }),
    ).resolves.toEqual({ success: true, documentUuid, email, keySigner });
    await expect(
      service.removeDocumentSigner(auth, { documentUuid, email, keySigner }),
    ).resolves.toEqual({ success: true, documentUuid, email, keySigner });
    await expect(service.blockUser(auth, email)).resolves.toEqual({ success: true, email });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      body: init?.body,
      method: init?.method,
      url: requestUrl(input),
    }));
    expect(calls.map(({ url }) => url.pathname)).toEqual([
      `/api/v1/documents/${documentUuid}/sendtosigner`,
      `/api/v1/documents/${documentUuid}/cancel`,
      `/api/v1/documents/${documentUuid}/resend`,
      `/api/v1/documents/${documentUuid}/removeemaillist`,
      '/api/v1/users/block',
    ]);
    expect(calls.every(({ method }) => method === 'POST')).toBe(true);
    expect(calls.map(({ body }) => body)).toEqual([
      JSON.stringify({
        skip_email: '0',
        workflow: '1',
        message: 'Assine o contrato',
        sign_limit_date: '31-12-27',
      }),
      JSON.stringify({ comment: 'Encerrado' }),
      JSON.stringify({ email, key_signer: keySigner }),
      JSON.stringify({ 'email-signer': email, 'key-signer': keySigner }),
      JSON.stringify({ email_user: email }),
    ]);
    expect(calls.every(({ url }) => url.searchParams.get('tokenAPI') === 'token-de-teste')).toBe(true);
    expect(invalidate).toHaveBeenCalled();

    const audit = logRecords.filter((record) => record.auditEvent === 'd4sign_mutation');
    expect(audit).toHaveLength(10);
    expect(new Set(audit.map((record) => record.action))).toEqual(new Set([
      'd4sign_document_send_for_signature',
      'd4sign_document_cancel',
      'd4sign_document_signature_link_resend',
      'd4sign_document_signer_remove',
      'd4sign_user_block',
    ]));
    expect(JSON.stringify(audit)).not.toContain(email);
    expect(JSON.stringify(audit)).not.toContain('Assine o contrato');
  });
});
