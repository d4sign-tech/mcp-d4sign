import type { McpServer } from '@modelcontextprotocol/server';

import type { Authorizer } from '../auth/authorize.js';
import { SCOPES } from '../auth/scopes.js';
import { ConfirmationError } from '../d4sign/errors.js';
import type { DocumentObservers, DocumentTags, UserVerification } from '../d4sign/types.js';
import type { ConfirmationWorkflow } from '../server/confirmation-workflow.js';
import type { D4SignFileService } from '../services/d4sign-file-service.js';
import type { D4SignReadService } from '../services/d4sign-read-service.js';
import type { D4SignWriteService } from '../services/d4sign-write-service.js';
import { toToolError } from '../shared/result.js';
import { hasConfirmationState, safeDisplay } from './tool-support.js';
import {
  BatchCreateInputSchema,
  BatchCreatedOutputSchema,
  DocumentAttachmentBinaryUploadInputSchema,
  DocumentAttachmentUploadInputSchema,
  DocumentAttachmentUploadedOutputSchema,
  DocumentBinaryUploadInputSchema,
  DocumentCreatedFromTemplateOutputSchema,
  DocumentDownloadInputSchema,
  DocumentDownloadOutputSchema,
  DocumentObserverRemoveInputSchema,
  DocumentObserverRemovedOutputSchema,
  DocumentObserversRemovedAllOutputSchema,
  DocumentSignerInfoAddInputSchema,
  DocumentSignerInfoAddedOutputSchema,
  DocumentSignersAddInputSchema,
  DocumentSignersAddedOutputSchema,
  DocumentSignerUpdateInputSchema,
  DocumentSignerUpdatedOutputSchema,
  DocumentTagRemoveInputSchema,
  DocumentTagRemovedOutputSchema,
  DocumentTagsRemovedAllOutputSchema,
  DocumentUploadInputSchema,
  DocumentUploadedOutputSchema,
  DocumentUuidInputSchema,
  TemplateDocumentCreateInputSchema,
  UserBlockInputSchema,
  UserUnblockedOutputSchema,
} from './schemas.js';

export const REMAINING_TOOL_NAMES = [
  'd4sign_batch_create',
  'd4sign_document_upload',
  'd4sign_document_attachment_upload',
  'd4sign_document_binary_upload',
  'd4sign_document_attachment_binary_upload',
  'd4sign_document_download',
  'd4sign_document_create_from_html_template',
  'd4sign_document_create_from_word_template',
  'd4sign_document_signers_add',
  'd4sign_document_signer_update',
  'd4sign_document_signer_info_add',
  'd4sign_user_unblock',
  'd4sign_document_tags_remove',
  'd4sign_document_tags_remove_all',
  'd4sign_document_unmark_urgent',
  'd4sign_document_observer_remove',
  'd4sign_document_observers_remove_all',
] as const;

function normalizedTags(tags: DocumentTags): Record<string, unknown> {
  return {
    documentUuid: tags.documentUuid,
    tags: [...tags.tags].sort((left, right) => left.localeCompare(right)),
  };
}

function normalizedObservers(observers: DocumentObservers): Record<string, unknown> {
  return {
    documentUuid: observers.documentUuid,
    observers: observers.observers
      .map((observer) => ({
        email: observer.email.toLocaleLowerCase(),
        profile: observer.profile,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
}

function validateBlockedUser(user: UserVerification, email: string): void {
  if (user.email.toLocaleLowerCase() !== email.toLocaleLowerCase()) {
    throw new ConfirmationError('A D4Sign verificou um usuário diferente do solicitado.');
  }
  if (!['blocked', 'bloqueado'].includes(user.status.trim().toLocaleLowerCase())) {
    throw new ConfirmationError('O usuário informado não está bloqueado.');
  }
}

export function registerRemainingTools(
  server: McpServer,
  readService: D4SignReadService,
  writeService: D4SignWriteService,
  fileService: D4SignFileService,
  confirmationWorkflow: ConfirmationWorkflow,
  authorize: Authorizer,
): void {
  server.registerTool(
    'd4sign_batch_create',
    {
      title: 'Criar lote D4Sign',
      description:
        'Cria um lote com 1 a 25 documentos identificados por UUIDs exatos. Use as tools de listagem antes quando os UUIDs não forem conhecidos. A operação altera o agrupamento dos documentos, não envia para assinatura e não exige confirmação.',
      inputSchema: BatchCreateInputSchema,
      outputSchema: BatchCreatedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuids }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.documentsWrite);
        const result = await writeService.createBatch(auth, documentUuids, ctx.mcpReq.signal);
        return {
          content: [{ type: 'text', text: `Lote ${result.batchId} criado com ${result.totalDocuments} documento(s).` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_upload',
    {
      title: 'Enviar documento principal à D4Sign',
      description:
        'Envia como documento principal um arquivo previamente ingerido por POST /uploads. Requer uploadHandle, vaultUuid e, opcionalmente, folderUuid. O handle é isolado por principal, expira e é consumido somente após sucesso na D4Sign.',
      inputSchema: DocumentUploadInputSchema,
      outputSchema: DocumentUploadedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ vaultUuid, folderUuid, uploadHandle, followSigningOrder }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.documentsWrite);
        const result = await fileService.uploadMainFromHandle(
          auth,
          {
            vaultUuid,
            uploadHandle,
            ...(folderUuid === undefined ? {} : { folderUuid }),
            ...(followSigningOrder === undefined ? {} : { followSigningOrder }),
          },
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `Documento ${result.documentUuid} recebido pela D4Sign e em processamento.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_attachment_upload',
    {
      title: 'Enviar anexo à D4Sign',
      description:
        'Anexa a um documento principal um arquivo previamente ingerido por POST /uploads. Requer o UUID exato do documento e um uploadHandle temporário. O handle é consumido somente após sucesso.',
      inputSchema: DocumentAttachmentUploadInputSchema,
      outputSchema: DocumentAttachmentUploadedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ mainDocumentUuid, uploadHandle }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.documentsWrite);
        const result = await fileService.uploadAttachmentFromHandle(
          auth,
          { mainDocumentUuid, uploadHandle },
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `Anexo enviado ao documento ${result.mainDocumentUuid}; processamento iniciado.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_binary_upload',
    {
      title: 'Enviar documento principal binário à D4Sign',
      description:
        'Envia um arquivo pequeno em base64 como documento principal. Requer vaultUuid, nome e MIME; o servidor valida tamanho, extensão e assinatura binária. Não aceita data URI nem URL externa.',
      inputSchema: DocumentBinaryUploadInputSchema,
      outputSchema: DocumentUploadedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ vaultUuid, folderUuid, base64, fileName, mimeType }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.documentsWrite);
        const result = await fileService.uploadMainBinary(
          auth,
          { vaultUuid, base64, fileName, mimeType, ...(folderUuid === undefined ? {} : { folderUuid }) },
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `Documento ${result.documentUuid} recebido pela D4Sign e em processamento.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_attachment_binary_upload',
    {
      title: 'Enviar anexo binário à D4Sign',
      description:
        'Anexa um arquivo pequeno em base64 a um documento principal. Valida tamanho, extensão, MIME e assinatura binária; não aceita data URI nem URL externa.',
      inputSchema: DocumentAttachmentBinaryUploadInputSchema,
      outputSchema: DocumentAttachmentUploadedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ mainDocumentUuid, base64, fileName, mimeType }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.documentsWrite);
        const result = await fileService.uploadAttachmentBinary(
          auth,
          { mainDocumentUuid, base64, fileName, mimeType },
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `Anexo binário enviado ao documento ${result.mainDocumentUuid}.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_download',
    {
      title: 'Gerar download de documento D4Sign',
      description:
        'Solicita uma URL HTTPS temporária para baixar um documento pelo UUID exato. Pode incluir documentos dos signatários e frames de video-selfie. A URL é sensível, não é acessada pelo servidor e não contém credenciais D4Sign anexadas pelo MCP.',
      inputSchema: DocumentDownloadInputSchema,
      outputSchema: DocumentDownloadOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ documentUuid, type, language, includeSignerDocuments, includeVideoSelfieFrames }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.documentsDownload);
        const result = await fileService.createDownload(
          auth,
          { documentUuid, type, language, includeSignerDocuments, includeVideoSelfieFrames },
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `Download temporário preparado para ${safeDisplay(result.name, 'documento')}.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  const registerTemplateTool = (kind: 'html' | 'word'): void => {
    const name = kind === 'html'
      ? 'd4sign_document_create_from_html_template'
      : 'd4sign_document_create_from_word_template';
    server.registerTool(
      name,
      {
        title: `Criar documento por template ${kind.toUpperCase()} D4Sign`,
        description: `Cria um documento em um cofre usando um ou mais templates ${kind.toUpperCase()} e variáveis explícitas. Use d4sign_templates_list e d4sign_vaults_list antes quando os identificadores não forem conhecidos. Não envia o documento para assinatura.`,
        inputSchema: TemplateDocumentCreateInputSchema,
        outputSchema: DocumentCreatedFromTemplateOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async ({ vaultUuid, folderUuid, documentName, templates }, ctx) => {
        try {
          const auth = authorize(ctx, SCOPES.documentsWrite);
          const result = await writeService.createDocumentFromTemplate(
            auth,
            { vaultUuid, documentName, templates, ...(folderUuid === undefined ? {} : { folderUuid }) },
            kind,
            ctx.mcpReq.signal,
          );
          return {
            content: [{ type: 'text', text: `Documento ${result.documentUuid} criado por template ${kind.toUpperCase()}.` }],
            structuredContent: result,
          };
        } catch (error) {
          return toToolError(error);
        }
      },
    );
  };
  registerTemplateTool('html');
  registerTemplateTool('word');

  server.registerTool(
    'd4sign_document_signers_add',
    {
      title: 'Cadastrar signatários no documento D4Sign',
      description:
        'Adiciona de 1 a 25 signatários explícitos a um documento que aguarda signatários. Requer documentUuid e configuração individual de ação/autenticação. Não envia o documento para assinatura.',
      inputSchema: DocumentSignersAddInputSchema,
      outputSchema: DocumentSignersAddedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuid, signers }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.signersWrite);
        authorize(ctx, SCOPES.documentsRead);
        // Releitura sem cache: o gate de fase precede uma mutação.
        const document = await readService.getDocumentFresh(auth, documentUuid, ctx.mcpReq.signal);
        if (document.statusId !== '2') {
          throw new ConfirmationError('O documento não está na fase 2, que permite cadastrar signatários.');
        }
        const result = await writeService.addDocumentSigners(auth, documentUuid, signers, ctx.mcpReq.signal);
        return {
          content: [{ type: 'text', text: `${result.signers.length} signatário(s) cadastrado(s) no documento.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_signer_update',
    {
      title: 'Alterar signatário do documento D4Sign',
      description:
        'Altera o e-mail de um signatário ainda pendente identificado pela combinação exata de e-mail atual e keySigner. Valida que exista um único alvo e não escolhe candidatos automaticamente.',
      inputSchema: DocumentSignerUpdateInputSchema,
      outputSchema: DocumentSignerUpdatedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuid, previousEmail, newEmail, keySigner }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.signersWrite);
        authorize(ctx, SCOPES.signersRead);
        const signers = await readService.listDocumentSignersFresh(auth, documentUuid, ctx.mcpReq.signal);
        const matches = signers.signers.filter(
          (signer) => signer.keySigner === keySigner
            && signer.email?.toLocaleLowerCase() === previousEmail.toLocaleLowerCase(),
        );
        if (matches.length !== 1 || matches[0]?.signed === true) {
          throw new ConfirmationError('Não existe exatamente um signatário pendente com o e-mail e a chave informados.');
        }
        const result = await writeService.updateDocumentSigner(
          auth,
          { documentUuid, previousEmail, newEmail, keySigner },
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `E-mail do signatário alterado para ${result.newEmail}.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_signer_info_add',
    {
      title: 'Adicionar informações do signatário D4Sign',
      description:
        'Adiciona nome, documento e/ou nascimento a um signatário identificado exatamente por e-mail e keySigner. O endpoint é destinado a assinaturas presenciais; nenhum dado é inferido e o signatário deve estar pendente.',
      inputSchema: DocumentSignerInfoAddInputSchema,
      outputSchema: DocumentSignerInfoAddedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuid, email, keySigner, displayName, documentation, birthday }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.signersWrite);
        authorize(ctx, SCOPES.signersRead);
        const signers = await readService.listDocumentSignersFresh(auth, documentUuid, ctx.mcpReq.signal);
        const matches = signers.signers.filter(
          (signer) => signer.keySigner === keySigner
            && signer.email?.toLocaleLowerCase() === email.toLocaleLowerCase(),
        );
        if (matches.length !== 1 || matches[0]?.signed === true) {
          throw new ConfirmationError('Não existe exatamente um signatário pendente com o e-mail e a chave informados.');
        }
        const result = await writeService.addDocumentSignerInfo(
          auth,
          {
            documentUuid,
            email,
            keySigner,
            ...(displayName === undefined ? {} : { displayName }),
            ...(documentation === undefined ? {} : { documentation }),
            ...(birthday === undefined ? {} : { birthday }),
          },
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `Informações adicionadas ao signatário ${result.email}.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_user_unblock',
    {
      title: 'Desbloquear usuário D4Sign',
      description:
        'Desbloqueia um usuário de domínio validado. É uma ação administrativa e exige confirmação humana assinada, temporária e de uso único, seguida de nova verificação do status.',
      inputSchema: UserBlockInputSchema,
      outputSchema: UserUnblockedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ email }, ctx) => {
      const args = { email };
      try {
        const auth = authorize(ctx, SCOPES.usersAdmin);
        authorize(ctx, SCOPES.usersRead);
        if (!hasConfirmationState(ctx)) {
          const user = await readService.verifyUser(auth, email, ctx.mcpReq.signal);
          validateBlockedUser(user, email);
          return await confirmationWorkflow.request(
            'd4sign_user_unblock',
            args,
            { email: user.email.toLocaleLowerCase(), status: user.status },
            [
              'CONFIRMAÇÃO ADMINISTRATIVA OBRIGATÓRIA.',
              `Operação: desbloquear o usuário «${safeDisplay(user.email, 'e-mail não informado')}».`,
              `Status atual: ${safeDisplay(user.status, 'não informado')}.`,
              'Consequência: o usuário poderá voltar a acessar funcionalidades vinculadas à conta.',
              'Marque confirm=true somente se deseja executar exatamente este desbloqueio.',
            ].join('\n'),
            ctx,
          );
        }
        const expectedSubject = await confirmationWorkflow.accept('d4sign_user_unblock', args, ctx);
        const user = await readService.verifyUserFresh(auth, email, ctx.mcpReq.signal);
        validateBlockedUser(user, email);
        confirmationWorkflow.assertSubjectUnchanged(expectedSubject, {
          email: user.email.toLocaleLowerCase(),
          status: user.status,
        });
        const result = await writeService.unblockUser(auth, email, ctx.mcpReq.signal);
        return {
          content: [{ type: 'text', text: `Usuário ${result.email} desbloqueado.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_tags_remove',
    {
      title: 'Remover tag do documento D4Sign',
      description:
        'Remove uma única tag explicitamente informada de um documento. Valida que a tag esteja presente e não aceita remoção abrangente; use a tool específica com confirmação para remover todas.',
      inputSchema: DocumentTagRemoveInputSchema,
      outputSchema: DocumentTagRemovedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuid, tag }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.tagsWrite);
        authorize(ctx, SCOPES.tagsRead);
        const tags = await readService.listDocumentTagsFresh(auth, documentUuid, ctx.mcpReq.signal);
        if (!tags.tags.includes(tag)) throw new ConfirmationError('A tag exata informada não existe no documento.');
        const result = await writeService.removeDocumentTag(auth, { documentUuid, tag }, ctx.mcpReq.signal);
        return {
          content: [{ type: 'text', text: `Tag removida do documento ${result.documentUuid}.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_tags_remove_all',
    {
      title: 'Remover todas as tags do documento D4Sign',
      description:
        'Remove todas as tags de um documento. É destrutiva e abrangente: lista os valores afetados, exige confirmação humana temporária de uso único e relê as tags antes da execução.',
      inputSchema: DocumentUuidInputSchema,
      outputSchema: DocumentTagsRemovedAllOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuid }, ctx) => {
      const args = { documentUuid };
      try {
        const auth = authorize(ctx, SCOPES.tagsWrite);
        authorize(ctx, SCOPES.tagsRead);
        authorize(ctx, SCOPES.documentsRead);
        if (!hasConfirmationState(ctx)) {
          const [document, tags] = await Promise.all([
            readService.getDocument(auth, documentUuid, ctx.mcpReq.signal),
            readService.listDocumentTags(auth, documentUuid, ctx.mcpReq.signal),
          ]);
          if (tags.tags.length === 0) throw new ConfirmationError('O documento não possui tags para remover.');
          return await confirmationWorkflow.request(
            'd4sign_document_tags_remove_all',
            args,
            normalizedTags(tags),
            [
              'CONFIRMAÇÃO DESTRUTIVA OBRIGATÓRIA.',
              `Documento: «${safeDisplay(document.name, 'sem nome')}» (${document.uuid}).`,
              `Serão removidas ${tags.tags.length} tag(s): ${tags.tags.map((tag) => `«${safeDisplay(tag, 'vazia')}»`).join(', ')}.`,
              'Consequência: toda a categorização por tags será apagada.',
              'Marque confirm=true somente se deseja executar exatamente esta remoção.',
            ].join('\n'),
            ctx,
          );
        }
        const expectedSubject = await confirmationWorkflow.accept('d4sign_document_tags_remove_all', args, ctx);
        const tags = await readService.listDocumentTagsFresh(auth, documentUuid, ctx.mcpReq.signal);
        if (tags.tags.length === 0) throw new ConfirmationError('O documento não possui mais tags para remover.');
        confirmationWorkflow.assertSubjectUnchanged(expectedSubject, normalizedTags(tags));
        const result = await writeService.removeAllDocumentTags(
          auth,
          documentUuid,
          tags.tags.length,
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `${result.removedCount} tag(s) removida(s) do documento.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_unmark_urgent',
    {
      title: 'Desmarcar documento urgente D4Sign',
      description:
        'Remove a marcação especial URGENTE de um documento pelo UUID exato. Altera somente essa categorização e não remove as demais tags.',
      inputSchema: DocumentUuidInputSchema,
      outputSchema: DocumentTagRemovedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuid }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.tagsWrite);
        const result = await writeService.unmarkDocumentUrgent(auth, documentUuid, ctx.mcpReq.signal);
        return {
          content: [{ type: 'text', text: `Marcação urgente removida do documento ${result.documentUuid}.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_observer_remove',
    {
      title: 'Remover observador do documento D4Sign',
      description:
        'Remove um único observador identificado pelo e-mail exato. Valida que exista exatamente um alvo e não seleciona candidatos automaticamente.',
      inputSchema: DocumentObserverRemoveInputSchema,
      outputSchema: DocumentObserverRemovedOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuid, email }, ctx) => {
      try {
        const auth = authorize(ctx, SCOPES.observersWrite);
        authorize(ctx, SCOPES.observersRead);
        const observers = await readService.listDocumentObserversFresh(auth, documentUuid, ctx.mcpReq.signal);
        const matches = observers.observers.filter(
          (observer) => observer.email.toLocaleLowerCase() === email.toLocaleLowerCase(),
        );
        if (matches.length !== 1) throw new ConfirmationError('Não existe exatamente um observador com o e-mail informado.');
        const result = await writeService.removeDocumentObserver(
          auth,
          { documentUuid, email },
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `Observador ${result.email} removido do documento.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    'd4sign_document_observers_remove_all',
    {
      title: 'Remover todos os observadores do documento D4Sign',
      description:
        'Remove todos os observadores de um documento. É destrutiva e abrangente: lista os destinatários, exige confirmação humana temporária de uso único e relê o estado antes da execução.',
      inputSchema: DocumentUuidInputSchema,
      outputSchema: DocumentObserversRemovedAllOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ documentUuid }, ctx) => {
      const args = { documentUuid };
      try {
        const auth = authorize(ctx, SCOPES.observersWrite);
        authorize(ctx, SCOPES.observersRead);
        authorize(ctx, SCOPES.documentsRead);
        if (!hasConfirmationState(ctx)) {
          const [document, observers] = await Promise.all([
            readService.getDocument(auth, documentUuid, ctx.mcpReq.signal),
            readService.listDocumentObservers(auth, documentUuid, ctx.mcpReq.signal),
          ]);
          if (observers.observers.length === 0) {
            throw new ConfirmationError('O documento não possui observadores para remover.');
          }
          return await confirmationWorkflow.request(
            'd4sign_document_observers_remove_all',
            args,
            normalizedObservers(observers),
            [
              'CONFIRMAÇÃO DESTRUTIVA OBRIGATÓRIA.',
              `Documento: «${safeDisplay(document.name, 'sem nome')}» (${document.uuid}).`,
              `Serão removidos ${observers.observers.length} observador(es): ${observers.observers.map((observer) => `«${safeDisplay(observer.email, 'sem e-mail')}»`).join(', ')}.`,
              'Consequência: todos perderão o acesso de observação configurado neste documento.',
              'Marque confirm=true somente se deseja executar exatamente esta remoção.',
            ].join('\n'),
            ctx,
          );
        }
        const expectedSubject = await confirmationWorkflow.accept(
          'd4sign_document_observers_remove_all',
          args,
          ctx,
        );
        const observers = await readService.listDocumentObserversFresh(auth, documentUuid, ctx.mcpReq.signal);
        if (observers.observers.length === 0) {
          throw new ConfirmationError('O documento não possui mais observadores para remover.');
        }
        confirmationWorkflow.assertSubjectUnchanged(expectedSubject, normalizedObservers(observers));
        const result = await writeService.removeAllDocumentObservers(
          auth,
          documentUuid,
          observers.observers.length,
          ctx.mcpReq.signal,
        );
        return {
          content: [{ type: 'text', text: `${result.removedCount} observador(es) removido(s) do documento.` }],
          structuredContent: result,
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
