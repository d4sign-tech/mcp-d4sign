import type { AuthContext } from '../auth/auth-context.js';
import type { CredentialProvider, D4SignCredentials } from '../auth/credential-provider.js';
import { D4SignClient } from '../d4sign/client.js';
import {
  parseAllObserversRemovedResponse,
  parseAllTagsRemovedResponse,
  parseBatchCreatedResponse,
  parseDocumentCancelledResponse,
  parseDocumentCreatedFromTemplateResponse,
  parseDocumentSentResponse,
  parseDocumentSignerInfoAddedResponse,
  parseDocumentSignerMutationResponse,
  parseDocumentSignersAddedResponse,
  parseDocumentSignerUpdatedResponse,
  parseFolderCreatedResponse,
  parseFolderRenamedResponse,
  parseObserverAddedResponse,
  parseObserverRemovedResponse,
  parseTagAddedResponse,
  parseTagRemovedResponse,
  parseUrgentTagRemovedResponse,
  parseUrgentTagAddedResponse,
  parseUserBlockedResponse,
  parseUserUnblockedResponse,
} from '../d4sign/schemas.js';
import type {
  BatchCreated,
  DocumentCancelled,
  DocumentCreatedFromTemplate,
  DocumentObserverAdded,
  DocumentObserverRemoved,
  DocumentObserversRemovedAll,
  DocumentSentForSignature,
  DocumentSignerMutation,
  DocumentSignerInfoAdded,
  DocumentSignersAdded,
  DocumentSignerUpdated,
  DocumentTagAdded,
  DocumentTagRemoved,
  DocumentTagsRemovedAll,
  FolderCreated,
  FolderRenamed,
  UserBlocked,
  UserUnblocked,
} from '../d4sign/types.js';
import type { Cache } from '../infra/cache.js';
import { cacheScope } from './d4sign-read-service.js';
import type { AppLogger } from '../infra/logger.js';
import type { QuotaManager } from '../infra/quota-manager.js';

export interface D4SignWriteServiceOptions {
  credentialProvider: CredentialProvider;
  cache: Cache;
  quotaManager: QuotaManager;
  logger: AppLogger;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
}

interface MutationAudit {
  action: string;
  targetType: 'document' | 'folder' | 'vault' | 'user';
  targetId: string;
}

export interface TemplateDocumentInput {
  vaultUuid: string;
  folderUuid?: string;
  documentName: string;
  templates: { templateId: string; variables: Record<string, string> }[];
}

export interface SignerCreateInput {
  email: string;
  action: number;
  foreign?: boolean | undefined;
  foreignLanguage?: 'en' | 'es' | 'pt' | 'it' | 'de' | undefined;
  requiresIcpBrasil?: boolean | undefined;
  icpBrasilCertificateType?: '1' | '2' | undefined;
  icpBrasilCpf?: string | undefined;
  icpBrasilCnpj?: string | undefined;
  inPerson?: boolean | undefined;
  authenticateDocument?: boolean | undefined;
  authenticateDocumentAndSelfie?: boolean | undefined;
  authenticationMethod?: 'email' | 'password' | 'sms' | 'whats' | undefined;
  authenticationPhone?: string | undefined;
  uploadAllowed?: boolean | undefined;
  uploadInstructions?: string | undefined;
  whatsappNumber?: string | undefined;
  groupUuid?: string | undefined;
  passwordCode?: string | undefined;
  videoSelfie?: boolean | undefined;
  afterPosition?: number | undefined;
  skipEmail?: boolean | undefined;
}

export class D4SignWriteService {
  constructor(private readonly options: D4SignWriteServiceOptions) {}

  async createBatch(
    auth: AuthContext,
    documentUuids: string[],
    signal?: AbortSignal,
  ): Promise<BatchCreated> {
    return this.mutate(
      auth,
      { action: 'd4sign_batch_create', targetType: 'document', targetId: 'multiple-documents' },
      [],
      async (client) =>
        parseBatchCreatedResponse(
          await client.request({
            method: 'POST',
            path: '/batches',
            body: { keys: documentUuids },
            ...(signal === undefined ? {} : { signal }),
          }),
          documentUuids,
        ),
    );
  }

  async createDocumentFromTemplate(
    auth: AuthContext,
    input: TemplateDocumentInput,
    kind: 'html' | 'word',
    signal?: AbortSignal,
  ): Promise<DocumentCreatedFromTemplate> {
    const templates = Object.fromEntries(
      input.templates.map((template) => [template.templateId, template.variables]),
    );
    return this.mutate(
      auth,
      {
        action: kind === 'html'
          ? 'd4sign_document_create_from_html_template'
          : 'd4sign_document_create_from_word_template',
        targetType: 'vault',
        targetId: input.vaultUuid,
      },
      ['documents-list', 'documents-list-by-phase', 'vault-documents-list'],
      async (client) =>
        parseDocumentCreatedFromTemplateResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.vaultUuid)}/${kind === 'html' ? 'makedocumentbytemplate' : 'makedocumentbytemplateword'}`,
            body: {
              name_document: input.documentName,
              templates,
              ...(input.folderUuid === undefined ? {} : { uuid_folder: input.folderUuid }),
            },
            ...(signal === undefined ? {} : { signal }),
          }),
          {
            vaultUuid: input.vaultUuid,
            ...(input.folderUuid === undefined ? {} : { folderUuid: input.folderUuid }),
            templateCount: input.templates.length,
            templateKind: kind,
          },
        ),
    );
  }

  async addDocumentSigners(
    auth: AuthContext,
    documentUuid: string,
    signers: SignerCreateInput[],
    signal?: AbortSignal,
  ): Promise<DocumentSignersAdded> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_signers_add', targetType: 'document', targetId: documentUuid },
      ['document-get', 'document-signers-list'],
      async (client) =>
        parseDocumentSignersAddedResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(documentUuid)}/createlist`,
            body: { signers: signers.map((signer) => this.signerBody(signer)) },
            ...(signal === undefined ? {} : { signal }),
          }),
          { documentUuid, requestedEmails: signers.map((signer) => signer.email) },
        ),
    );
  }

  async updateDocumentSigner(
    auth: AuthContext,
    input: { documentUuid: string; previousEmail: string; newEmail: string; keySigner: string },
    signal?: AbortSignal,
  ): Promise<DocumentSignerUpdated> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_signer_update', targetType: 'document', targetId: input.documentUuid },
      ['document-signers-list'],
      async (client) =>
        parseDocumentSignerUpdatedResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.documentUuid)}/changeemail`,
            body: {
              'email-before': input.previousEmail,
              'email-after': input.newEmail,
              'key-signer': input.keySigner,
            },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async addDocumentSignerInfo(
    auth: AuthContext,
    input: {
      documentUuid: string;
      email: string;
      keySigner: string;
      displayName?: string;
      documentation?: string;
      birthday?: string;
    },
    signal?: AbortSignal,
  ): Promise<DocumentSignerInfoAdded> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_signer_info_add', targetType: 'document', targetId: input.documentUuid },
      ['document-signers-list'],
      async (client) =>
        parseDocumentSignerInfoAddedResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.documentUuid)}/addinfo`,
            body: {
              key_signer: input.keySigner,
              email: input.email,
              ...(input.displayName === undefined ? {} : { display_name: input.displayName }),
              ...(input.documentation === undefined ? {} : { documentation: input.documentation }),
              ...(input.birthday === undefined ? {} : { birthday: input.birthday }),
            },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async unblockUser(auth: AuthContext, email: string, signal?: AbortSignal): Promise<UserUnblocked> {
    return this.mutate(
      auth,
      { action: 'd4sign_user_unblock', targetType: 'user', targetId: 'redacted-user' },
      ['user-verify'],
      async (client) =>
        parseUserUnblockedResponse(
          await client.request({
            method: 'POST',
            path: '/users/unblock',
            body: { email_user: email },
            ...(signal === undefined ? {} : { signal }),
          }),
          email,
        ),
    );
  }

  async removeDocumentTag(
    auth: AuthContext,
    input: { documentUuid: string; tag: string },
    signal?: AbortSignal,
  ): Promise<DocumentTagRemoved> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_tags_remove', targetType: 'document', targetId: input.documentUuid },
      ['document-tags-list'],
      async (client) =>
        parseTagRemovedResponse(
          await client.request({
            method: 'POST',
            path: `/tags/${encodeURIComponent(input.documentUuid)}/remove`,
            body: { tag: input.tag },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async removeAllDocumentTags(
    auth: AuthContext,
    documentUuid: string,
    removedCount: number,
    signal?: AbortSignal,
  ): Promise<DocumentTagsRemovedAll> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_tags_remove_all', targetType: 'document', targetId: documentUuid },
      ['document-tags-list'],
      async (client) =>
        parseAllTagsRemovedResponse(
          await client.request({
            method: 'POST',
            path: `/tags/${encodeURIComponent(documentUuid)}/erase`,
            ...(signal === undefined ? {} : { signal }),
          }),
          documentUuid,
          removedCount,
        ),
    );
  }

  async unmarkDocumentUrgent(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentTagRemoved> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_unmark_urgent', targetType: 'document', targetId: documentUuid },
      ['document-tags-list'],
      async (client) =>
        parseUrgentTagRemovedResponse(
          await client.request({
            method: 'POST',
            path: `/tags/${encodeURIComponent(documentUuid)}/removeurgent`,
            ...(signal === undefined ? {} : { signal }),
          }),
          documentUuid,
        ),
    );
  }

  async removeDocumentObserver(
    auth: AuthContext,
    input: { documentUuid: string; email: string },
    signal?: AbortSignal,
  ): Promise<DocumentObserverRemoved> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_observer_remove', targetType: 'document', targetId: input.documentUuid },
      ['document-observers-list'],
      async (client) =>
        parseObserverRemovedResponse(
          await client.request({
            method: 'POST',
            path: `/watcher/${encodeURIComponent(input.documentUuid)}/remove`,
            body: { email: input.email },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async removeAllDocumentObservers(
    auth: AuthContext,
    documentUuid: string,
    removedCount: number,
    signal?: AbortSignal,
  ): Promise<DocumentObserversRemovedAll> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_observers_remove_all', targetType: 'document', targetId: documentUuid },
      ['document-observers-list'],
      async (client) =>
        parseAllObserversRemovedResponse(
          await client.request({
            method: 'POST',
            path: `/watcher/${encodeURIComponent(documentUuid)}/erase`,
            ...(signal === undefined ? {} : { signal }),
          }),
          documentUuid,
          removedCount,
        ),
    );
  }

  async createVaultFolder(
    auth: AuthContext,
    input: { vaultUuid: string; parentFolderUuid?: string; folderName: string },
    signal?: AbortSignal,
  ): Promise<FolderCreated> {
    return this.mutate(
      auth,
      { action: 'd4sign_vault_folder_create', targetType: 'vault', targetId: input.vaultUuid },
      ['vault-folders-list'],
      async (client) =>
        parseFolderCreatedResponse(
          await client.request({
            method: 'POST',
            path: `/folders/${encodeURIComponent(input.vaultUuid)}/create`,
            body: {
              folder_name: input.folderName,
              ...(input.parentFolderUuid === undefined ? {} : { uuid_folder: input.parentFolderUuid }),
            },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  private signerBody(signer: SignerCreateInput): Record<string, unknown> {
    const binary = (value: boolean | undefined): string | undefined =>
      value === undefined ? undefined : value ? '1' : '0';
    return {
      email: signer.email,
      act: String(signer.action),
      foreign: binary(signer.foreign ?? false),
      ...(signer.foreignLanguage === undefined ? {} : { foreign_lang: signer.foreignLanguage }),
      certificadoicpbr: binary(signer.requiresIcpBrasil ?? false),
      ...(signer.icpBrasilCertificateType === undefined
        ? {}
        : { certificadoicpbr_tipo: signer.icpBrasilCertificateType }),
      ...(signer.icpBrasilCpf === undefined ? {} : { certificadoicpbr_cpf: signer.icpBrasilCpf }),
      ...(signer.icpBrasilCnpj === undefined ? {} : { certificadoicpbr_cnpj: signer.icpBrasilCnpj }),
      assinatura_presencial: binary(signer.inPerson ?? false),
      ...(signer.authenticateDocument === undefined ? {} : { docauth: binary(signer.authenticateDocument) }),
      ...(signer.authenticateDocumentAndSelfie === undefined
        ? {}
        : { docauthandselfie: binary(signer.authenticateDocumentAndSelfie) }),
      ...(signer.authenticationMethod === undefined ? {} : { embed_methodauth: signer.authenticationMethod }),
      ...(signer.authenticationPhone === undefined ? {} : { embed_smsnumber: signer.authenticationPhone }),
      ...(signer.uploadAllowed === undefined ? {} : { upload_allow: binary(signer.uploadAllowed) }),
      ...(signer.uploadInstructions === undefined ? {} : { upload_obs: signer.uploadInstructions }),
      ...(signer.whatsappNumber === undefined ? {} : { whatsapp_number: signer.whatsappNumber }),
      ...(signer.groupUuid === undefined ? {} : { uuid_grupo: signer.groupUuid }),
      ...(signer.passwordCode === undefined ? {} : { password_code: signer.passwordCode }),
      ...(signer.videoSelfie === undefined ? {} : { videoselfie: binary(signer.videoSelfie) }),
      ...(signer.afterPosition === undefined ? {} : { after_position: String(signer.afterPosition) }),
      ...(signer.skipEmail === undefined ? {} : { skipemail: binary(signer.skipEmail) }),
    };
  }

  async renameVaultFolder(
    auth: AuthContext,
    input: { vaultUuid: string; folderUuid: string; folderName: string },
    signal?: AbortSignal,
  ): Promise<FolderRenamed> {
    return this.mutate(
      auth,
      { action: 'd4sign_vault_folder_rename', targetType: 'folder', targetId: input.folderUuid },
      ['vault-folders-list'],
      async (client) =>
        parseFolderRenamedResponse(
          await client.request({
            method: 'POST',
            path: `/folders/${encodeURIComponent(input.vaultUuid)}/rename`,
            body: { folder_name: input.folderName, uuid_folder: input.folderUuid },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async addDocumentTag(
    auth: AuthContext,
    input: { documentUuid: string; tag: string },
    signal?: AbortSignal,
  ): Promise<DocumentTagAdded> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_tags_add', targetType: 'document', targetId: input.documentUuid },
      ['document-tags-list'],
      async (client) =>
        parseTagAddedResponse(
          await client.request({
            method: 'POST',
            path: `/tags/${encodeURIComponent(input.documentUuid)}/add`,
            body: { tag: input.tag },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async markDocumentUrgent(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentTagAdded> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_mark_urgent', targetType: 'document', targetId: documentUuid },
      ['document-tags-list'],
      async (client) =>
        parseUrgentTagAddedResponse(
          await client.request({
            method: 'POST',
            path: `/tags/${encodeURIComponent(documentUuid)}/addurgent`,
            ...(signal === undefined ? {} : { signal }),
          }),
          documentUuid,
        ),
    );
  }

  async addDocumentObserver(
    auth: AuthContext,
    input: { documentUuid: string; email: string; permission: '0' | '1' },
    signal?: AbortSignal,
  ): Promise<DocumentObserverAdded> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_observer_add', targetType: 'document', targetId: input.documentUuid },
      ['document-observers-list'],
      async (client) =>
        parseObserverAddedResponse(
          await client.request({
            method: 'POST',
            path: `/watcher/${encodeURIComponent(input.documentUuid)}/add`,
            body: { email: input.email, permission: input.permission },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async sendDocumentForSignature(
    auth: AuthContext,
    input: {
      documentUuid: string;
      notifySigners: boolean;
      workflow: 'simultaneous' | 'ordered';
      message?: string;
      signLimitDate?: string;
    },
    signal?: AbortSignal,
  ): Promise<DocumentSentForSignature> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_send_for_signature', targetType: 'document', targetId: input.documentUuid },
      [
        'document-get',
        'document-signers-list',
        'documents-list',
        'documents-list-by-phase',
        'vault-documents-list',
      ],
      async (client) =>
        parseDocumentSentResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.documentUuid)}/sendtosigner`,
            body: {
              skip_email: input.notifySigners ? '0' : '1',
              workflow: input.workflow === 'ordered' ? '1' : '0',
              ...(input.message === undefined ? {} : { message: input.message }),
              ...(input.signLimitDate === undefined ? {} : { sign_limit_date: input.signLimitDate }),
            },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async cancelDocument(
    auth: AuthContext,
    input: { documentUuid: string; comment?: string },
    signal?: AbortSignal,
  ): Promise<DocumentCancelled> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_cancel', targetType: 'document', targetId: input.documentUuid },
      ['document-get', 'documents-list', 'documents-list-by-phase', 'vault-documents-list'],
      async (client) =>
        parseDocumentCancelledResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.documentUuid)}/cancel`,
            ...(input.comment === undefined ? {} : { body: { comment: input.comment } }),
            ...(signal === undefined ? {} : { signal }),
          }),
          input.documentUuid,
        ),
    );
  }

  async resendDocumentSignatureLink(
    auth: AuthContext,
    input: { documentUuid: string; email: string; keySigner: string },
    signal?: AbortSignal,
  ): Promise<DocumentSignerMutation> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_signature_link_resend', targetType: 'document', targetId: input.documentUuid },
      ['document-signers-list'],
      async (client) =>
        parseDocumentSignerMutationResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.documentUuid)}/resend`,
            body: { email: input.email, key_signer: input.keySigner },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async removeDocumentSigner(
    auth: AuthContext,
    input: { documentUuid: string; email: string; keySigner: string },
    signal?: AbortSignal,
  ): Promise<DocumentSignerMutation> {
    return this.mutate(
      auth,
      { action: 'd4sign_document_signer_remove', targetType: 'document', targetId: input.documentUuid },
      ['document-get', 'document-signers-list'],
      async (client) =>
        parseDocumentSignerMutationResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.documentUuid)}/removeemaillist`,
            body: { 'email-signer': input.email, 'key-signer': input.keySigner },
            ...(signal === undefined ? {} : { signal }),
          }),
          input,
        ),
    );
  }

  async blockUser(auth: AuthContext, email: string, signal?: AbortSignal): Promise<UserBlocked> {
    return this.mutate(
      auth,
      { action: 'd4sign_user_block', targetType: 'user', targetId: 'redacted-user' },
      ['user-verify'],
      async (client) =>
        parseUserBlockedResponse(
          await client.request({
            method: 'POST',
            path: '/users/block',
            body: { email_user: email },
            ...(signal === undefined ? {} : { signal }),
          }),
          email,
        ),
    );
  }

  private async mutate<T>(
    auth: AuthContext,
    audit: MutationAudit,
    invalidatedOperations: string[],
    operation: (client: D4SignClient) => Promise<T>,
  ): Promise<T> {
    const auditFields = {
      auditEvent: 'd4sign_mutation',
      action: audit.action,
      principalId: auth.principalId,
      tenantId: auth.tenantId,
      targetType: audit.targetType,
      targetId: audit.targetId,
    };
    this.options.logger.info({ ...auditFields, outcome: 'started' }, 'Mutação D4Sign iniciada');

    try {
      const credentials = await this.options.credentialProvider.getCredentials(auth);
      const client = this.createClient(credentials);
      const result = await operation(client);
      const cacheInvalidated = await this.invalidateCache(
        auth.tenantId,
        client.accountFingerprint,
        invalidatedOperations,
        auditFields,
      );
      this.options.logger.info(
        { ...auditFields, outcome: 'succeeded', cacheInvalidated },
        'Mutação D4Sign concluída',
      );
      return result;
    } catch (error) {
      this.options.logger.warn({ ...auditFields, outcome: 'failed' }, 'Mutação D4Sign falhou');
      throw error;
    }
  }

  /**
   * Invalida apenas os escopos da conta que sofreu a mutação.
   *
   * Uma falha aqui NÃO dispara limpeza global: apagar o cache de todos os
   * tenants por causa de uma mutação de um só multiplicaria o raio de impacto e
   * poderia esgotar a cota D4Sign de contas não envolvidas. O TTL curto de cada
   * entrada é o limite superior da inconsistência, e a falha é auditada.
   */
  private async invalidateCache(
    tenantId: string,
    accountFingerprint: string,
    invalidatedOperations: string[],
    auditFields: Record<string, string>,
  ): Promise<boolean> {
    const failed: string[] = [];
    for (const cacheOperation of invalidatedOperations) {
      try {
        await this.options.cache.invalidate(cacheScope(tenantId, accountFingerprint, cacheOperation));
      } catch {
        failed.push(cacheOperation);
      }
    }
    if (failed.length === 0) return true;
    this.options.logger.error(
      {
        ...auditFields,
        auditEvent: 'd4sign_cache_invalidation',
        outcome: 'failed',
        failedOperations: failed,
      },
      'Falha ao invalidar cache após mutação D4Sign; leituras podem ficar obsoletas até o TTL expirar',
    );
    return false;
  }

  private createClient(credentials: D4SignCredentials): D4SignClient {
    return new D4SignClient({
      credentials,
      quotaManager: this.options.quotaManager,
      logger: this.options.logger,
      timeoutMs: this.options.timeoutMs,
      maxResponseBytes: this.options.maxResponseBytes,
      ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
    });
  }
}
