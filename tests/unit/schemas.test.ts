import { describe, expect, it } from 'vitest';

import {
  parseAttachmentsResponse,
  parseDocumentResponse,
  parseDocumentCancelledResponse,
  parseDocumentsResponse,
  parseFoldersResponse,
  parseFolderCreatedResponse,
  parseFolderRenamedResponse,
  parseObserversResponse,
  parseObserverAddedResponse,
  parseSignersResponse,
  parseSignatureGroupDetailsResponse,
  parseSignatureGroupsResponse,
  parseTagsResponse,
  parseTagAddedResponse,
  parseTemplatesResponse,
  parseUserVerificationResponse,
  parseUrgentTagAddedResponse,
  parseVaultsResponse,
  parseWebhooksResponse,
} from '../../src/d4sign/schemas.js';
import { D4SignResponseError } from '../../src/d4sign/errors.js';

const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';
const groupUuid = 'aea20243-475a-43fc-8ba5-c02f6eec76fc';
const accountUuid = '509d5808-0797-4d26-b21a-f76e9e07cc49';

const upstreamDocument = {
  uuidDoc: documentUuid,
  nameDoc: 'contrato.pdf',
  type: 'application/pdf',
  size: '118990',
  pages: '6',
  uuidSafe: vaultUuid,
  safeName: 'Contratos',
  statusId: '3',
  statusName: 'Aguardando Assinaturas',
  ignoredFutureField: true,
};

describe('schemas de resposta D4Sign', () => {
  it('aceita no cancelamento a mensagem antiga e o documento cancelado do contrato atual', () => {
    expect(parseDocumentCancelledResponse({ message: 'Document canceled' }, documentUuid)).toEqual({
      success: true,
      documentUuid,
    });
    expect(parseDocumentCancelledResponse({
      ...upstreamDocument,
      statusId: '6',
      statusName: 'Canceled',
    }, documentUuid)).toEqual({ success: true, documentUuid });
    expect(() => parseDocumentCancelledResponse(upstreamDocument, documentUuid)).toThrow(D4SignResponseError);
  });

  it('normaliza cofres com a chave oficial e com a variante observada em produção', () => {
    expect(
      parseVaultsResponse([{ 'uuid-safe': vaultUuid, 'name-safe': 'Contratos' }]),
    ).toEqual([{ uuid: vaultUuid, name: 'Contratos' }]);
    expect(
      parseVaultsResponse([{ uuid_safe: vaultUuid, 'name-safe': 'Contratos' }]),
    ).toEqual([{ uuid: vaultUuid, name: 'Contratos' }]);
  });

  it('rejeita UUIDs de cofre ambíguos quando as duas variantes divergem', () => {
    expect(() =>
      parseVaultsResponse([
        {
          'uuid-safe': vaultUuid,
          uuid_safe: groupUuid,
          'name-safe': 'Contratos',
        },
      ]),
    ).toThrow(D4SignResponseError);
  });

  it('normaliza documento e converte números enviados como texto', () => {
    expect(parseDocumentResponse(upstreamDocument)).toEqual({
      uuid: documentUuid,
      name: 'contrato.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 118990,
      pages: 6,
      vaultUuid,
      vaultName: 'Contratos',
      statusId: '3',
      statusName: 'Aguardando Assinaturas',
    });
  });

  it('aceita a resposta de detalhe como array unitário observado em produção', () => {
    expect(parseDocumentResponse([upstreamDocument])).toMatchObject({
      uuid: documentUuid,
      name: 'contrato.pdf',
      statusId: '3',
    });
    expect(() => parseDocumentResponse([])).toThrow(D4SignResponseError);
    expect(() => parseDocumentResponse([upstreamDocument, upstreamDocument])).toThrow(D4SignResponseError);
  });

  it('separa metadados de paginação e aplica o limite MCP local', () => {
    const result = parseDocumentsResponse(
      [
        { total_documents: '2', total_in_this_page: '2', current_page: '1', total_pages: '3' },
        upstreamDocument,
        { ...upstreamDocument, uuidDoc: 'aea20243-475a-43fc-8ba5-c02f6eec76fc' },
      ],
      1,
      1,
    );

    expect(result.documents).toHaveLength(1);
    expect(result).toMatchObject({ page: 1, totalDocuments: 2, totalPages: 3, hasMore: true });
  });

  it('remove dados sensíveis não selecionados ao normalizar signatários', () => {
    const result = parseSignersResponse({
      uuidDoc: documentUuid,
      list: {
        key_signer: 'NwYj=',
        user_name: 'Pessoa Teste',
        email: 'pessoa@example.com',
        signed: '1',
        embed_methodauth: 'email',
        date: '2026-07-31 10:00:00',
        password_code: 'segredo-que-nao-deve-sair',
        sign_info: { ip: '192.0.2.1' },
      },
    });

    expect(result.signers).toEqual([
      {
        keySigner: 'NwYj=',
        name: 'Pessoa Teste',
        email: 'pessoa@example.com',
        signed: true,
        authenticationMethod: 'email',
        addedAt: '2026-07-31 10:00:00',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('192.0.2.1');
    expect(JSON.stringify(result)).not.toContain('segredo-que-nao-deve-sair');
  });

  it('aceita signatários dentro do array unitário observado em produção', () => {
    const result = parseSignersResponse([
      {
        ...upstreamDocument,
        list: [
          {
            key_signer: 'NwYj=',
            user_name: 'Pessoa Teste',
            email: 'pessoa@example.com',
            signed: '0',
          },
        ],
      },
    ]);

    expect(result).toMatchObject({
      documentUuid,
      signers: [{ keySigner: 'NwYj=', signed: false }],
    });
  });

  it('converte a lista de tags separada por vírgulas', () => {
    expect(parseTagsResponse({ uuid_arquivo: documentUuid, TAGs: 'urgente, jurídico, ' })).toEqual({
      documentUuid,
      tags: ['urgente', 'jurídico'],
    });
  });

  it('normaliza pastas do cofre', () => {
    expect(
      parseFoldersResponse([
        {
          uuid_safe: vaultUuid,
          uuid_folder: 'aea20243-475a-43fc-8ba5-c02f6eec76fc',
          name: 'Contratos 2026',
          dt_cadastro: '2026-08-11 10:00:00',
        },
      ]),
    ).toEqual([
      {
        uuid: 'aea20243-475a-43fc-8ba5-c02f6eec76fc',
        vaultUuid,
        name: 'Contratos 2026',
        createdAt: '2026-08-11 10:00:00',
      },
    ]);
  });

  it('aceita variáveis de template como objeto ou array', () => {
    expect(
      parseTemplatesResponse([
        { id: 'MzE=', name: 'Template HTML', variables: { 0: 'nome', 1: 'cpf' } },
        { id: 'MzI=', name: 'Template Word', variables: ['empresa', 'valor'] },
      ]),
    ).toEqual([
      { id: 'MzE=', name: 'Template HTML', variables: ['nome', 'cpf'] },
      { id: 'MzI=', name: 'Template Word', variables: ['empresa', 'valor'] },
    ]);
  });

  it('normaliza o objeto indexado e os grupos de variáveis observados em produção', () => {
    expect(
      parseTemplatesResponse({
        1: { id: 'MzE=', name: 'Template HTML', variables: ['nome'] },
        2: {
          id: 'MzI=',
          name: 'Template Word',
          variables: {
            preenchedor: ['nome', 'cpf'],
            tokens_gerais: ['empresa', 'valor'],
          },
        },
      }),
    ).toEqual([
      { id: 'MzE=', name: 'Template HTML', variables: ['nome'] },
      { id: 'MzI=', name: 'Template Word', variables: ['nome', 'cpf', 'empresa', 'valor'] },
    ]);
  });

  it('normaliza anexos e preserva os metadados disponíveis', () => {
    const result = parseAttachmentsResponse(
      [
        { total_documents: 1, total_in_this_page: 1, current_page: 1, total_pages: 1 },
        { ...upstreamDocument, nameDoc: 'anexo.pdf' },
      ],
      documentUuid,
      20,
    );
    expect(result).toMatchObject({
      documentUuid,
      totalAttachments: 1,
      totalPages: 1,
      attachments: [{ uuid: documentUuid, name: 'anexo.pdf' }],
    });
  });

  it('normaliza grupos de assinatura', () => {
    expect(parseSignatureGroupsResponse([{ uuid_grupo: groupUuid, nome: 'Jurídico' }])).toEqual([
      { uuid: groupUuid, name: 'Jurídico' },
    ]);
  });

  it('normaliza detalhes de grupo e converte flags documentadas', () => {
    const result = parseSignatureGroupDetailsResponse(
      {
        name_group: 'Jurídico',
        group_details: [
          {
            uuid_conta: accountUuid,
            uuid_grupo: groupUuid,
            email: 'juridico@example.com',
            tipo_assinatura: '1',
            nome_tipo_assinatura: 'Assinar',
            sequencia: '2',
            certificado_digital: '1',
            doc_auth: '0',
            doc_authselfie: 1,
            assinatura_presencial: false,
            estrangeiro: '0',
            removido: '0',
            desativar_remocao: '1',
            signatario_editavel: '1',
            upload_permitido: '0',
            upload_obs: null,
            clausula_destaque: '1',
            dt_cadastro: '2026-08-11 10:00:00',
            unknownSecret: 'não deve sair',
          },
        ],
      },
      vaultUuid,
      groupUuid,
    );

    expect(result).toMatchObject({
      vaultUuid,
      groupUuid,
      name: 'Jurídico',
      members: [
        {
          accountUuid,
          groupUuid,
          email: 'juridico@example.com',
          signatureTypeId: '1',
          signatureTypeName: 'Assinar',
          sequence: 2,
          requiresDigitalCertificate: true,
          requiresDocumentAuthentication: false,
          requiresDocumentAndSelfie: true,
          removalDisabled: true,
          editable: true,
          highlightedClause: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('não deve sair');
  });

  it('normaliza a verificação de usuário', () => {
    expect(parseUserVerificationResponse({ user: 'pessoa@example.com', status: 'unblocked' })).toEqual({
      email: 'pessoa@example.com',
      status: 'unblocked',
    });
  });

  it('normaliza observadores do documento', () => {
    expect(
      parseObserversResponse(
        {
          uuid_arquivo: documentUuid,
          watchers: [{ email: 'observador@example.com', perfil: 0 }],
        },
        documentUuid,
      ),
    ).toEqual({
      documentUuid,
      observers: [{ email: 'observador@example.com', profile: '0' }],
    });
  });

  it('trata watchers nulo como uma lista vazia observada em produção', () => {
    expect(parseObserversResponse({ uuid_arquivo: documentUuid, watchers: null }, documentUuid)).toEqual({
      documentUuid,
      observers: [],
    });
  });

  it('normaliza o webhook v1 sem expor campos extras', () => {
    const result = parseWebhooksResponse(
      {
        uuid: documentUuid,
        webhook_url: 'https://example.com/d4sign/events',
        history: ['campo v2 não exposto'],
      },
      documentUuid,
    );
    expect(result).toEqual({
      documentUuid,
      webhooks: [{ url: 'https://example.com/d4sign/events' }],
    });
    expect(JSON.stringify(result)).not.toContain('campo v2');
  });

  it('normaliza respostas de mutação sem refletir mensagens upstream', () => {
    expect(
      parseFolderCreatedResponse(
        { message: 'Folder created', uuid: groupUuid, ignored: 'upstream' },
        { vaultUuid, parentFolderUuid: accountUuid, folderName: 'Contratos' },
      ),
    ).toEqual({
      success: true,
      vaultUuid,
      folderUuid: groupUuid,
      parentFolderUuid: accountUuid,
      folderName: 'Contratos',
    });
    expect(
      parseFolderRenamedResponse(
        { message: 'Folder changed' },
        { vaultUuid, folderUuid: groupUuid, folderName: 'Contratos 2027' },
      ),
    ).toMatchObject({ success: true, folderUuid: groupUuid, folderName: 'Contratos 2027' });
    expect(
      parseTagAddedResponse(
        { message: 'TAGs added successfully', TAGs: 'jurídico' },
        { documentUuid, tag: 'jurídico' },
      ),
    ).toEqual({ success: true, documentUuid, tag: 'jurídico' });
    expect(
      parseUrgentTagAddedResponse(
        { message: 'TAGs Urgent added successfully', TAGS: 'Urgent' },
        documentUuid,
      ),
    ).toEqual({ success: true, documentUuid, tag: 'URGENTE' });
    expect(
      parseObserverAddedResponse(
        { message: 'Email added successfully', uuid: documentUuid, watcher: 'Pessoa@Example.com' },
        { documentUuid, email: 'pessoa@example.com', permission: '1' },
      ),
    ).toEqual({ success: true, documentUuid, email: 'pessoa@example.com', permission: '1' });
  });

  it('rejeita uma resposta fora do contrato', () => {
    expect(() => parseDocumentResponse({ uuidDoc: 'não-é-uuid' })).toThrow(D4SignResponseError);
  });
});
