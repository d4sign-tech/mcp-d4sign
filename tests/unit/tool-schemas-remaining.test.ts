import { describe, expect, it } from 'vitest';

import {
  BatchCreateInputSchema,
  DocumentBinaryUploadInputSchema,
  DocumentDownloadInputSchema,
  DocumentSignersAddInputSchema,
  DocumentSignerUpdateInputSchema,
  TemplateDocumentCreateInputSchema,
} from '../../src/tools/schemas.js';

const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';

describe('schemas das 17 tools finais', () => {
  it('limita lote a UUIDs únicos e rejeita propriedades extras', () => {
    expect(BatchCreateInputSchema.safeParse({ documentUuids: [documentUuid] }).success).toBe(true);
    expect(BatchCreateInputSchema.safeParse({ documentUuids: [documentUuid, documentUuid] }).success).toBe(false);
    expect(BatchCreateInputSchema.safeParse({ documentUuids: [documentUuid], tokenAPI: 'segredo' }).success).toBe(false);
  });

  it('restringe upload binário a nome simples, MIME permitido e base64 limitado', () => {
    const valid = {
      vaultUuid,
      base64: Buffer.from('%PDF-1.7').toString('base64'),
      fileName: 'contrato.pdf',
      mimeType: 'application/pdf',
    };
    expect(DocumentBinaryUploadInputSchema.safeParse(valid).success).toBe(true);
    expect(DocumentBinaryUploadInputSchema.safeParse({ ...valid, fileName: '../contrato.pdf' }).success).toBe(false);
    expect(DocumentBinaryUploadInputSchema.safeParse({ ...valid, mimeType: 'text/html' }).success).toBe(false);
  });

  it('valida dependências entre autenticação e campos do signatário', () => {
    const base = { documentUuid, signers: [{ email: 'pessoa@example.com', action: 1 }] };
    expect(DocumentSignersAddInputSchema.safeParse(base).success).toBe(true);
    expect(DocumentSignersAddInputSchema.safeParse({
      documentUuid,
      signers: [{ email: 'pessoa@example.com', action: 1, authenticationMethod: 'sms' }],
    }).success).toBe(false);
    expect(DocumentSignersAddInputSchema.safeParse({
      documentUuid,
      signers: [{
        email: 'pessoa@example.com',
        action: 1,
        authenticationMethod: 'sms',
        authenticationPhone: '+5511999999999',
      }],
    }).success).toBe(true);
  });

  it('impede atualização para o mesmo e-mail e aplica defaults de download', () => {
    expect(DocumentSignerUpdateInputSchema.safeParse({
      documentUuid,
      previousEmail: 'pessoa@example.com',
      newEmail: 'pessoa@example.com',
      keySigner: 'chave',
    }).success).toBe(false);
    expect(DocumentDownloadInputSchema.parse({ documentUuid })).toEqual({
      documentUuid,
      type: 'pdf',
      language: 'pt',
      includeSignerDocuments: false,
      includeVideoSelfieFrames: false,
    });
  });

  it('aceita templates explícitos e rejeita IDs repetidos', () => {
    const template = { templateId: 'template-1', variables: { nome: 'Pessoa' } };
    expect(TemplateDocumentCreateInputSchema.safeParse({
      vaultUuid,
      documentName: 'Contrato',
      templates: [template],
    }).success).toBe(true);
    expect(TemplateDocumentCreateInputSchema.safeParse({
      vaultUuid,
      documentName: 'Contrato',
      templates: [template, template],
    }).success).toBe(false);
  });
});
