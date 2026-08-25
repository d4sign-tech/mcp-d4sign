import { describe, expect, it } from 'vitest';

import { UploadError } from '../../src/d4sign/errors.js';
import { decodeBase64File, sanitizeFileName, validateUploadFile } from '../../src/d4sign/file-validation.js';
import { InMemoryUploadStore } from '../../src/infra/upload-store.js';

const auth = { principalId: 'principal-a', tenantId: 'tenant-a' };
const pdf = Buffer.from('%PDF-1.7\nconteudo de teste', 'ascii');

describe('segurança de arquivos', () => {
  it('valida nome, tamanho, MIME real e base64 canônico', () => {
    expect(sanitizeFileName('contrato.pdf')).toBe('contrato.pdf');
    expect(() => sanitizeFileName('../contrato.pdf')).toThrow(UploadError);
    expect(() => sanitizeFileName('pasta/contrato.pdf')).toThrow(UploadError);
    expect(() => validateUploadFile({
      bytes: pdf,
      fileName: 'contrato.png',
      mimeType: 'application/pdf',
      maxBytes: 1_000,
    })).toThrow('extensão');
    expect(() => validateUploadFile({
      bytes: pdf,
      fileName: 'imagem.png',
      mimeType: 'image/png',
      maxBytes: 1_000,
    })).toThrow('não corresponde');
    expect(() => validateUploadFile({
      bytes: pdf,
      fileName: 'contrato.pdf',
      mimeType: 'application/pdf',
      maxBytes: 5,
    })).toThrow('excede');

    const encoded = pdf.toString('base64');
    expect(decodeBase64File(encoded, 1_000)).toEqual(pdf);
    expect(() => decodeBase64File(`data:application/pdf;base64,${encoded}`, 1_000)).toThrow(UploadError);
    expect(() => decodeBase64File('%%%invalido%%%', 1_000)).toThrow(UploadError);
  });

  it('isola handles por principal/tenant, devolve cópia defensiva e expira conteúdo', async () => {
    let now = 1_000;
    const store = new InMemoryUploadStore(60_000, 10, () => now);
    const receipt = await store.put(auth, {
      fileName: 'contrato.pdf',
      mimeType: 'application/pdf',
      bytes: pdf,
    });
    expect(receipt).toMatchObject({ fileName: 'contrato.pdf', sizeBytes: pdf.byteLength });
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/u);

    const first = await store.get(auth, receipt.uploadHandle);
    first.bytes.fill(0);
    const second = await store.get(auth, receipt.uploadHandle);
    expect(Buffer.from(second.bytes).toString('ascii')).toContain('%PDF-');

    await expect(store.get(
      { principalId: 'principal-b', tenantId: 'tenant-a' },
      receipt.uploadHandle,
    )).rejects.toThrow(UploadError);
    await expect(store.get(
      { principalId: 'principal-a', tenantId: 'tenant-b' },
      receipt.uploadHandle,
    )).rejects.toThrow(UploadError);

    now += 60_001;
    await expect(store.get(auth, receipt.uploadHandle)).rejects.toThrow(UploadError);
  });
});
