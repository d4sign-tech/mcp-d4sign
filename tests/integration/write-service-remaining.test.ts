import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { D4SignWriteService } from '../../src/services/d4sign-write-service.js';

const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';
const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const createdUuid = 'aea20243-475a-43fc-8ba5-c02f6eec76fc';
const auth = { principalId: 'test-user', tenantId: 'test-tenant' };
const email = 'pessoa@example.com';
const keySigner = 'signer-key-1';

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

describe('D4SignWriteService — contratos restantes', () => {
  it('executa lote, templates, signatários, usuário, tags e observadores com contratos exatos', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const pathname = requestUrl(input).pathname;
      let response: unknown = { message: 'Operação concluída' };
      if (pathname === '/api/v1/batches') {
        response = { message: 'Batch created', uuid_batches: 'batch-1', total: '1' };
      } else if (pathname.includes('makedocumentbytemplate')) {
        response = { uuid: createdUuid };
      } else if (pathname.endsWith('/createlist')) {
        response = { key_signer: keySigner, email, status: '0' };
      } else if (pathname.endsWith('/addinfo')) {
        response = {
          'uuid-doc': documentUuid,
          email,
          name: 'Pessoa Teste',
          documentation: 'omitido',
          birthday: 'omitido',
          status: '0',
        };
      } else if (pathname.endsWith('/tags/' + documentUuid + '/remove')) {
        response = { message: 'TAG removed', TAGs: 'juridico' };
      } else if (pathname.endsWith('/tags/' + documentUuid + '/removeurgent')) {
        response = { message: 'Urgent removed', TAGs: 'URGENTE' };
      } else if (pathname.endsWith('/watcher/' + documentUuid + '/remove')) {
        response = { message: 'Watcher removed', watcher: email };
      }
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });
    const service = new D4SignWriteService({
      credentialProvider: new MockCredentialProvider({ tokenApi: 'token-de-teste', environment: 'sandbox' }),
      cache: new InMemoryPrivateCache(),
      quotaManager: new InMemoryQuotaManager(100),
      logger: pino({ enabled: false }),
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      fetchImpl: fetchMock,
    });

    await expect(service.createBatch(auth, [documentUuid])).resolves.toEqual({
      success: true,
      batchId: 'batch-1',
      totalDocuments: 1,
      documentUuids: [documentUuid],
    });
    await expect(service.createDocumentFromTemplate(auth, {
      vaultUuid,
      documentName: 'Contrato HTML',
      templates: [{ templateId: 'html-1', variables: { nome: 'Pessoa' } }],
    }, 'html')).resolves.toMatchObject({ documentUuid: createdUuid, templateKind: 'html' });
    await expect(service.createDocumentFromTemplate(auth, {
      vaultUuid,
      documentName: 'Contrato Word',
      templates: [{ templateId: 'word-1', variables: { empresa: 'ACME' } }],
    }, 'word')).resolves.toMatchObject({ documentUuid: createdUuid, templateKind: 'word' });
    await expect(service.addDocumentSigners(auth, documentUuid, [{
      email,
      action: 1,
      authenticationMethod: 'sms',
      authenticationPhone: '+5511999999999',
      requiresIcpBrasil: false,
    }])).resolves.toMatchObject({ documentUuid, requestedCount: 1, signers: [{ email, keySigner }] });
    await expect(service.updateDocumentSigner(auth, {
      documentUuid,
      previousEmail: email,
      newEmail: 'novo@example.com',
      keySigner,
    })).resolves.toMatchObject({ success: true, newEmail: 'novo@example.com' });
    await expect(service.addDocumentSignerInfo(auth, {
      documentUuid,
      email,
      keySigner,
      displayName: 'Pessoa Teste',
      documentation: '12345678900',
      birthday: '01/01/1990',
    })).resolves.toEqual({
      success: true,
      documentUuid,
      email,
      keySigner,
      displayName: 'Pessoa Teste',
      status: '0',
    });
    await expect(service.unblockUser(auth, email)).resolves.toEqual({ success: true, email });
    await expect(service.removeDocumentTag(auth, { documentUuid, tag: 'juridico' })).resolves.toEqual({
      success: true,
      documentUuid,
      tag: 'juridico',
    });
    await expect(service.removeAllDocumentTags(auth, documentUuid, 2)).resolves.toEqual({
      success: true,
      documentUuid,
      removedCount: 2,
    });
    await expect(service.unmarkDocumentUrgent(auth, documentUuid)).resolves.toEqual({
      success: true,
      documentUuid,
      tag: 'URGENTE',
    });
    await expect(service.removeDocumentObserver(auth, { documentUuid, email })).resolves.toEqual({
      success: true,
      documentUuid,
      email,
    });
    await expect(service.removeAllDocumentObservers(auth, documentUuid, 3)).resolves.toEqual({
      success: true,
      documentUuid,
      removedCount: 3,
    });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      path: requestUrl(input).pathname,
      body: init?.body,
      token: requestUrl(input).searchParams.get('tokenAPI'),
    }));
    expect(calls.map(({ path }) => path)).toEqual([
      '/api/v1/batches',
      `/api/v1/documents/${vaultUuid}/makedocumentbytemplate`,
      `/api/v1/documents/${vaultUuid}/makedocumentbytemplateword`,
      `/api/v1/documents/${documentUuid}/createlist`,
      `/api/v1/documents/${documentUuid}/changeemail`,
      `/api/v1/documents/${documentUuid}/addinfo`,
      '/api/v1/users/unblock',
      `/api/v1/tags/${documentUuid}/remove`,
      `/api/v1/tags/${documentUuid}/erase`,
      `/api/v1/tags/${documentUuid}/removeurgent`,
      `/api/v1/watcher/${documentUuid}/remove`,
      `/api/v1/watcher/${documentUuid}/erase`,
    ]);
    expect(calls.every(({ token }) => token === 'token-de-teste')).toBe(true);
    expect(calls[0]?.body).toBe(JSON.stringify({ keys: [documentUuid] }));
    expect(calls[3]?.body).toBe(JSON.stringify({ signers: [{
      email,
      act: '1',
      foreign: '0',
      certificadoicpbr: '0',
      assinatura_presencial: '0',
      embed_methodauth: 'sms',
      embed_smsnumber: '+5511999999999',
    }] }));
    expect(calls[4]?.body).toBe(JSON.stringify({
      'email-before': email,
      'email-after': 'novo@example.com',
      'key-signer': keySigner,
    }));
  });
});
