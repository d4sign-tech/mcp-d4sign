import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { D4SignWriteService } from '../../src/services/d4sign-write-service.js';

const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';
const parentFolderUuid = '509d5808-0797-4d26-b21a-f76e9e07cc49';
const folderUuid = 'aea20243-475a-43fc-8ba5-c02f6eec76fc';
const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const auth = { principalId: 'test-user', tenantId: 'test-tenant' };

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

describe('D4SignWriteService — Sprint 4', () => {
  it('executa os cinco contratos, audita e invalida somente os caches relacionados', async () => {
    const logRecords: Record<string, unknown>[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        logRecords.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        callback();
      },
    });
    const logger = pino({ level: 'info' }, destination);
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      let response: unknown;
      if (url.pathname === `/api/v1/folders/${vaultUuid}/create`) {
        response = { message: 'Folder created', uuid: folderUuid };
      } else if (url.pathname === `/api/v1/folders/${vaultUuid}/rename`) {
        response = { message: 'Folder changed' };
      } else if (url.pathname === `/api/v1/tags/${documentUuid}/add`) {
        response = { message: 'TAGs added successfully', TAGs: 'jurídico' };
      } else if (url.pathname === `/api/v1/tags/${documentUuid}/addurgent`) {
        response = { message: 'TAGs Urgent added successfully', TAGS: 'Urgent' };
      } else if (url.pathname === `/api/v1/watcher/${documentUuid}/add`) {
        response = { message: 'Email added successfully', uuid: documentUuid, watcher: 'pessoa@example.com' };
      } else {
        return Promise.resolve(new Response('{}', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
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
      service.createVaultFolder(auth, { vaultUuid, parentFolderUuid, folderName: 'Jurídico' }),
    ).resolves.toMatchObject({ success: true, folderUuid, parentFolderUuid });
    await expect(
      service.renameVaultFolder(auth, { vaultUuid, folderUuid, folderName: 'Jurídico 2027' }),
    ).resolves.toMatchObject({ success: true, folderUuid, folderName: 'Jurídico 2027' });
    await expect(
      service.addDocumentTag(auth, { documentUuid, tag: 'jurídico' }),
    ).resolves.toEqual({ success: true, documentUuid, tag: 'jurídico' });
    await expect(service.markDocumentUrgent(auth, documentUuid)).resolves.toEqual({
      success: true,
      documentUuid,
      tag: 'URGENTE',
    });
    await expect(
      service.addDocumentObserver(auth, {
        documentUuid,
        email: 'pessoa@example.com',
        permission: '1',
      }),
    ).resolves.toMatchObject({ success: true, documentUuid, permission: '1' });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      body: init?.body,
      method: init?.method,
      url: requestUrl(input),
    }));
    expect(calls).toHaveLength(5);
    expect(calls.every(({ method }) => method === 'POST')).toBe(true);
    expect(calls[0]?.body).toBe(JSON.stringify({ folder_name: 'Jurídico', uuid_folder: parentFolderUuid }));
    expect(calls[1]?.body).toBe(JSON.stringify({ folder_name: 'Jurídico 2027', uuid_folder: folderUuid }));
    expect(calls[2]?.body).toBe(JSON.stringify({ tag: 'jurídico' }));
    expect(calls[3]?.body).toBeUndefined();
    expect(calls[4]?.body).toBe(JSON.stringify({ email: 'pessoa@example.com', permission: '1' }));
    expect(calls.every(({ url }) => url.searchParams.get('tokenAPI') === 'token-de-teste')).toBe(true);

    const invalidatedSuffixes = invalidate.mock.calls.map(([scope]) => scope.slice(scope.lastIndexOf(':') + 1));
    expect(invalidatedSuffixes).toEqual([
      'vault-folders-list',
      'vault-folders-list',
      'document-tags-list',
      'document-tags-list',
      'document-observers-list',
    ]);

    const audit = logRecords.filter((record) => record.auditEvent === 'd4sign_mutation');
    expect(audit).toHaveLength(10);
    expect(audit.filter((record) => record.outcome === 'started')).toHaveLength(5);
    expect(audit.filter((record) => record.outcome === 'succeeded')).toHaveLength(5);
    expect(new Set(audit.map((record) => record.action))).toEqual(new Set([
      'd4sign_vault_folder_create',
      'd4sign_vault_folder_rename',
      'd4sign_document_tags_add',
      'd4sign_document_mark_urgent',
      'd4sign_document_observer_add',
    ]));
    expect(JSON.stringify(audit)).not.toContain('pessoa@example.com');
    expect(JSON.stringify(audit)).not.toContain('jurídico');
  });
});
