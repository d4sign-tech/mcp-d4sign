import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { D4SignReadService } from '../../src/services/d4sign-read-service.js';

const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';
const folderUuid = 'aea20243-475a-43fc-8ba5-c02f6eec76fc';
const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const logger = pino({ enabled: false });
const auth = { principalId: 'test-user', tenantId: 'test-tenant' };

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

const document = {
  uuidDoc: documentUuid,
  nameDoc: 'contrato.pdf',
  type: 'application/pdf',
  size: '123',
  pages: '2',
  uuidSafe: vaultUuid,
  safeName: 'Contratos',
  statusId: '3',
  statusName: 'Aguardando Assinaturas',
};

describe('D4SignReadService — Sprint 2', () => {
  it('chama os cinco contratos com método, path e paginação corretos', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      let response: unknown;
      if (url.pathname === `/api/v1/documents/${vaultUuid}/safe/${folderUuid}`) {
        response = [{ total_documents: 1, total_pages: 2 }, document];
      } else if (url.pathname === `/api/v1/folders/${vaultUuid}/find`) {
        response = [{ uuid_safe: vaultUuid, uuid_folder: folderUuid, name: 'Jurídico' }];
      } else if (url.pathname === '/api/v1/documents/3/status') {
        response = [{ total_documents: 1, total_pages: 1 }, document];
      } else if (url.pathname === '/api/v1/templates') {
        response = [{ id: 'MzE=', name: 'Contrato padrão', variables: { 0: 'nome' } }];
      } else if (url.pathname === `/api/v1/documents/${documentUuid}/listslaves`) {
        response = [{ total_documents: 1, total_pages: 1 }, { ...document, nameDoc: 'anexo.pdf' }];
      } else {
        return Promise.resolve(new Response('{}', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });
    const service = new D4SignReadService({
      credentialProvider: new MockCredentialProvider({ tokenApi: 'token-de-teste', environment: 'sandbox' }),
      cache: new InMemoryPrivateCache(),
      quotaManager: new InMemoryQuotaManager(10),
      logger,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      fetchImpl: fetchMock,
    });

    await expect(
      service.listVaultDocuments(auth, { vaultUuid, folderUuid, page: 2, limit: 20 }),
    ).resolves.toMatchObject({ page: 2, totalPages: 2, documents: [{ uuid: documentUuid }] });
    await expect(service.listVaultFolders(auth, vaultUuid)).resolves.toEqual([
      { uuid: folderUuid, vaultUuid, name: 'Jurídico', createdAt: null },
    ]);
    await expect(
      service.listDocumentsByPhase(auth, { phaseId: 3, page: 1, limit: 20 }),
    ).resolves.toMatchObject({ documents: [{ uuid: documentUuid }] });
    await expect(service.listTemplates(auth)).resolves.toEqual([
      { id: 'MzE=', name: 'Contrato padrão', variables: ['nome'] },
    ]);
    await expect(service.listDocumentAttachments(auth, documentUuid, 20)).resolves.toMatchObject({
      documentUuid,
      attachments: [{ name: 'anexo.pdf' }],
      totalAttachments: 1,
    });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      method: init?.method,
      url: requestUrl(input),
    }));
    expect(calls).toHaveLength(5);
    expect(calls[0]?.url.searchParams.get('pg')).toBe('2');
    expect(calls[2]?.url.searchParams.get('pg')).toBe('1');
    expect(calls[3]?.method).toBe('POST');
    expect(calls.every(({ url }) => url.searchParams.get('tokenAPI') === 'token-de-teste')).toBe(true);
  });

  it('não repete a chamada upstream quando muda somente o limite local', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify([{ total_documents: 1, total_pages: 1 }, document]))),
    );
    const service = new D4SignReadService({
      credentialProvider: new MockCredentialProvider({ tokenApi: 'token-de-teste', environment: 'sandbox' }),
      cache: new InMemoryPrivateCache(),
      quotaManager: new InMemoryQuotaManager(10),
      logger,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      fetchImpl: fetchMock,
    });

    await service.listDocuments(auth, { page: 1, limit: 1 });
    await service.listDocuments(auth, { page: 1, limit: 20 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
