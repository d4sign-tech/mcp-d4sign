import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { InMemoryUploadStore } from '../../src/infra/upload-store.js';
import { D4SignFileService } from '../../src/services/d4sign-file-service.js';

const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';
const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const createdUuid = 'aea20243-475a-43fc-8ba5-c02f6eec76fc';
const auth = { principalId: 'test-user', tenantId: 'test-tenant' };
const pdf = Buffer.from('%PDF-1.7\nconteudo de teste', 'ascii');

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

describe('D4SignFileService', () => {
  it('executa multipart, binário e download sem expor credenciais nos resultados', async () => {
    const uploadStore = new InMemoryUploadStore(600_000);
    const mainReceipt = await uploadStore.put(auth, {
      fileName: 'principal.pdf',
      mimeType: 'application/pdf',
      bytes: pdf,
    });
    const attachmentReceipt = await uploadStore.put(auth, {
      fileName: 'anexo.pdf',
      mimeType: 'application/pdf',
      bytes: pdf,
    });
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const pathname = requestUrl(input).pathname;
      if (pathname.endsWith('/download')) {
        return Promise.resolve(new Response(JSON.stringify({
          name: 'contrato.pdf',
          url: 'https://downloads.d4sign.example/temporary/object',
        }), { status: 200 }));
      }
      const response = pathname.endsWith('/upload') || pathname.endsWith('/uploadbinary')
        ? { uuid: createdUuid }
        : { message: 'Upload successful' };
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });
    const service = new D4SignFileService({
      credentialProvider: new MockCredentialProvider({ tokenApi: 'token-de-teste', environment: 'sandbox' }),
      cache: new InMemoryPrivateCache(),
      quotaManager: new InMemoryQuotaManager(100),
      uploadStore,
      logger: pino({ enabled: false }),
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      maxUploadBytes: 1_000_000,
      fetchImpl: fetchMock,
    });

    await expect(service.uploadMainFromHandle(auth, {
      vaultUuid,
      uploadHandle: mainReceipt.uploadHandle,
      followSigningOrder: true,
    })).resolves.toMatchObject({ documentUuid: createdUuid, fileName: 'principal.pdf' });
    await expect(uploadStore.get(auth, mainReceipt.uploadHandle)).rejects.toThrow();

    await expect(service.uploadAttachmentFromHandle(auth, {
      mainDocumentUuid: documentUuid,
      uploadHandle: attachmentReceipt.uploadHandle,
    })).resolves.toMatchObject({ mainDocumentUuid: documentUuid, fileName: 'anexo.pdf' });
    await expect(uploadStore.get(auth, attachmentReceipt.uploadHandle)).rejects.toThrow();

    const base64 = pdf.toString('base64');
    await expect(service.uploadMainBinary(auth, {
      vaultUuid,
      base64,
      fileName: 'binario.pdf',
      mimeType: 'application/pdf',
    })).resolves.toMatchObject({ documentUuid: createdUuid, sizeBytes: pdf.byteLength });
    await expect(service.uploadAttachmentBinary(auth, {
      mainDocumentUuid: documentUuid,
      base64,
      fileName: 'anexo-binario.pdf',
      mimeType: 'application/pdf',
    })).resolves.toMatchObject({ mainDocumentUuid: documentUuid, sizeBytes: pdf.byteLength });
    await expect(service.createDownload(auth, {
      documentUuid,
      type: 'zip',
      language: 'pt',
      includeSignerDocuments: true,
      includeVideoSelfieFrames: false,
    })).resolves.toEqual({
      documentUuid,
      name: 'contrato.pdf',
      url: 'https://downloads.d4sign.example/temporary/object',
      type: 'zip',
      language: 'pt',
      includesSignerDocuments: true,
      includesVideoSelfieFrames: false,
    });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      path: requestUrl(input).pathname,
      body: init?.body,
      contentType: (init?.headers as Record<string, string> | undefined)?.['Content-Type'],
    }));
    expect(calls.map(({ path }) => path)).toEqual([
      `/api/v1/documents/${vaultUuid}/upload`,
      `/api/v1/documents/${documentUuid}/uploadslave`,
      `/api/v1/documents/${vaultUuid}/uploadbinary`,
      `/api/v1/documents/${documentUuid}/uploadslavebinary`,
      `/api/v1/documents/${documentUuid}/download`,
    ]);
    expect(calls[0]?.body).toBeInstanceOf(FormData);
    expect(calls[0]?.contentType).toBeUndefined();
    expect((calls[0]?.body as FormData).get('workflow')).toBe('1');
    expect(calls[2]?.body).toBe(JSON.stringify({
      base64_binary_file: base64,
      mime_type: 'application/pdf',
      name: 'binario.pdf',
    }));
    expect(calls[4]?.body).toBe(JSON.stringify({
      type: 'zip',
      language: 'pt',
      document: true,
      videoselfie_frame: false,
    }));
  });

  it('mantém o handle disponível quando a D4Sign rejeita o upload', async () => {
    const uploadStore = new InMemoryUploadStore(600_000);
    const receipt = await uploadStore.put(auth, {
      fileName: 'principal.pdf',
      mimeType: 'application/pdf',
      bytes: pdf,
    });
    const service = new D4SignFileService({
      credentialProvider: new MockCredentialProvider({ tokenApi: 'token-de-teste', environment: 'sandbox' }),
      cache: new InMemoryPrivateCache(),
      quotaManager: new InMemoryQuotaManager(10),
      uploadStore,
      logger: pino({ enabled: false }),
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      maxUploadBytes: 1_000_000,
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ message: 'rejeitado' }), { status: 400 })),
    });
    await expect(service.uploadMainFromHandle(auth, {
      vaultUuid,
      uploadHandle: receipt.uploadHandle,
    })).rejects.toThrow();
    await expect(uploadStore.get(auth, receipt.uploadHandle)).resolves.toMatchObject({ fileName: 'principal.pdf' });
  });
});
