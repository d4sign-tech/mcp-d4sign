import { createHash } from 'node:crypto';

import type { AuthContext } from '../auth/auth-context.js';
import type { CredentialProvider, D4SignCredentials } from '../auth/credential-provider.js';
import { D4SignClient } from '../d4sign/client.js';
import { UploadError } from '../d4sign/errors.js';
import { decodeBase64File, validateUploadFile } from '../d4sign/file-validation.js';
import {
  parseDocumentAttachmentUploadedResponse,
  parseDocumentDownloadResponse,
  parseDocumentUploadedResponse,
} from '../d4sign/schemas.js';
import type {
  DocumentAttachmentUploaded,
  DocumentDownload,
  DocumentUploaded,
} from '../d4sign/types.js';
import type { Cache } from '../infra/cache.js';
import type { AppLogger } from '../infra/logger.js';
import type { QuotaManager } from '../infra/quota-manager.js';
import type { ClaimStore } from '../infra/claim-store.js';
import { InMemoryClaimStore } from '../infra/claim-store.js';
import type { StagedUpload, UploadStore } from '../infra/upload-store.js';
import { cacheScope } from './d4sign-read-service.js';

export interface D4SignFileServiceOptions {
  credentialProvider: CredentialProvider;
  cache: Cache;
  quotaManager: QuotaManager;
  uploadStore: UploadStore;
  logger: AppLogger;
  timeoutMs: number;
  maxResponseBytes: number;
  maxUploadBytes: number;
  fetchImpl?: typeof fetch;
  /** Reserva exclusiva do uploadHandle enquanto ele está sendo consumido. */
  claimStore?: ClaimStore;
  claimTtlMs?: number;
}

interface MainUploadInput {
  vaultUuid: string;
  folderUuid?: string;
  followSigningOrder?: boolean;
}

interface BinaryFileInput {
  base64: string;
  fileName: string;
  mimeType: string;
}

export class D4SignFileService {
  private readonly claims: ClaimStore;
  private readonly claimTtlMs: number;

  constructor(private readonly options: D4SignFileServiceOptions) {
    this.claims = options.claimStore ?? new InMemoryClaimStore();
    this.claimTtlMs = options.claimTtlMs ?? Math.max(30_000, options.timeoutMs * 3);
  }

  /**
   * Garante consumo exclusivo do handle.
   *
   * Sem isso, duas chamadas simultâneas com o mesmo `uploadHandle` — em tasks
   * diferentes — leriam o mesmo objeto e criariam dois documentos na D4Sign. O
   * claim é devolvido em caso de falha, para que o retry documentado continue
   * possível com o mesmo handle.
   */
  private async withHandleClaim<T>(
    auth: AuthContext,
    uploadHandle: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const claimKey = `upload:${auth.tenantId}:${auth.principalId}:${uploadHandle}`;
    if (!(await this.claims.acquire(claimKey, this.claimTtlMs))) {
      throw new UploadError('Este uploadHandle já está sendo consumido por outra requisição.');
    }
    try {
      return await operation();
    } catch (error) {
      await this.claims.release(claimKey);
      throw error;
    }
  }

  async uploadMainFromHandle(
    auth: AuthContext,
    input: MainUploadInput & { uploadHandle: string },
    signal?: AbortSignal,
  ): Promise<DocumentUploaded> {
    return this.withHandleClaim(auth, input.uploadHandle, () => this.uploadMainFromHandleClaimed(auth, input, signal));
  }

  private async uploadMainFromHandleClaimed(
    auth: AuthContext,
    input: MainUploadInput & { uploadHandle: string },
    signal?: AbortSignal,
  ): Promise<DocumentUploaded> {
    const staged = await this.options.uploadStore.get(auth, input.uploadHandle);
    const file = validateUploadFile({ ...staged, maxBytes: this.options.maxUploadBytes });
    const result = await this.mutate(
      auth,
      'd4sign_document_upload',
      'vault',
      input.vaultUuid,
      ['documents-list', 'documents-list-by-phase', 'vault-documents-list'],
      async (client) => {
        const formData = this.createFormData(file);
        if (input.folderUuid !== undefined) formData.set('uuid_folder', input.folderUuid);
        if (input.followSigningOrder !== undefined) {
          formData.set('workflow', input.followSigningOrder ? '1' : '2');
        }
        return parseDocumentUploadedResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.vaultUuid)}/upload`,
            formData,
            ...(signal === undefined ? {} : { signal }),
          }),
          {
            vaultUuid: input.vaultUuid,
            folderUuid: input.folderUuid ?? null,
            fileName: staged.fileName,
            mimeType: staged.mimeType,
            sizeBytes: staged.sizeBytes,
            sha256: staged.sha256,
          },
        );
      },
    );
    await this.options.uploadStore.delete(auth, input.uploadHandle);
    return result;
  }

  async uploadAttachmentFromHandle(
    auth: AuthContext,
    input: { mainDocumentUuid: string; uploadHandle: string },
    signal?: AbortSignal,
  ): Promise<DocumentAttachmentUploaded> {
    return this.withHandleClaim(
      auth,
      input.uploadHandle,
      () => this.uploadAttachmentFromHandleClaimed(auth, input, signal),
    );
  }

  private async uploadAttachmentFromHandleClaimed(
    auth: AuthContext,
    input: { mainDocumentUuid: string; uploadHandle: string },
    signal?: AbortSignal,
  ): Promise<DocumentAttachmentUploaded> {
    const staged = await this.options.uploadStore.get(auth, input.uploadHandle);
    const file = validateUploadFile({ ...staged, maxBytes: this.options.maxUploadBytes });
    const result = await this.mutate(
      auth,
      'd4sign_document_attachment_upload',
      'document',
      input.mainDocumentUuid,
      ['document-attachments-list'],
      async (client) =>
        parseDocumentAttachmentUploadedResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.mainDocumentUuid)}/uploadslave`,
            formData: this.createFormData(file),
            ...(signal === undefined ? {} : { signal }),
          }),
          {
            mainDocumentUuid: input.mainDocumentUuid,
            fileName: staged.fileName,
            mimeType: staged.mimeType,
            sizeBytes: staged.sizeBytes,
            sha256: staged.sha256,
          },
        ),
    );
    await this.options.uploadStore.delete(auth, input.uploadHandle);
    return result;
  }

  async uploadMainBinary(
    auth: AuthContext,
    input: MainUploadInput & BinaryFileInput,
    signal?: AbortSignal,
  ): Promise<DocumentUploaded> {
    const file = this.validateBinaryFile(input);
    return this.mutate(
      auth,
      'd4sign_document_binary_upload',
      'vault',
      input.vaultUuid,
      ['documents-list', 'documents-list-by-phase', 'vault-documents-list'],
      async (client) =>
        parseDocumentUploadedResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.vaultUuid)}/uploadbinary`,
            body: {
              base64_binary_file: input.base64,
              mime_type: file.mimeType,
              name: file.fileName,
              ...(input.folderUuid === undefined ? {} : { uuid_folder: input.folderUuid }),
            },
            ...(signal === undefined ? {} : { signal }),
          }),
          {
            vaultUuid: input.vaultUuid,
            folderUuid: input.folderUuid ?? null,
            fileName: file.fileName,
            mimeType: file.mimeType,
            sizeBytes: file.bytes.byteLength,
            sha256: createHash('sha256').update(file.bytes).digest('hex'),
          },
        ),
    );
  }

  async uploadAttachmentBinary(
    auth: AuthContext,
    input: { mainDocumentUuid: string } & BinaryFileInput,
    signal?: AbortSignal,
  ): Promise<DocumentAttachmentUploaded> {
    const file = this.validateBinaryFile(input);
    return this.mutate(
      auth,
      'd4sign_document_attachment_binary_upload',
      'document',
      input.mainDocumentUuid,
      ['document-attachments-list'],
      async (client) =>
        parseDocumentAttachmentUploadedResponse(
          await client.request({
            method: 'POST',
            path: `/documents/${encodeURIComponent(input.mainDocumentUuid)}/uploadslavebinary`,
            body: {
              base64_binary_file: input.base64,
              mime_type: file.mimeType,
              name: file.fileName,
            },
            ...(signal === undefined ? {} : { signal }),
          }),
          {
            mainDocumentUuid: input.mainDocumentUuid,
            fileName: file.fileName,
            mimeType: file.mimeType,
            sizeBytes: file.bytes.byteLength,
            sha256: createHash('sha256').update(file.bytes).digest('hex'),
          },
        ),
    );
  }

  async createDownload(
    auth: AuthContext,
    input: {
      documentUuid: string;
      type: 'pdf' | 'pdfa' | 'zip';
      language: 'pt' | 'en';
      includeSignerDocuments: boolean;
      includeVideoSelfieFrames: boolean;
    },
    signal?: AbortSignal,
  ): Promise<DocumentDownload> {
    // Geração de URL de documento assinado é a leitura mais sensível do
    // catálogo e precisa de trilha de auditoria própria. A URL e o nome do
    // arquivo continuam fora do log; só o fato e o alvo são registrados.
    return this.mutate(
      auth,
      'd4sign_document_download',
      'document',
      input.documentUuid,
      [],
      async (client) => parseDocumentDownloadResponse(
      await client.request({
        method: 'POST',
        path: `/documents/${encodeURIComponent(input.documentUuid)}/download`,
        body: {
          type: input.type,
          language: input.language,
          document: input.includeSignerDocuments,
          videoselfie_frame: input.includeVideoSelfieFrames,
        },
        ...(signal === undefined ? {} : { signal }),
      }),
      {
        documentUuid: input.documentUuid,
        type: input.type,
        language: input.language,
        includesSignerDocuments: input.includeSignerDocuments,
        includesVideoSelfieFrames: input.includeVideoSelfieFrames,
      },
      ),
    );
  }

  private validateBinaryFile(input: BinaryFileInput) {
    const bytes = decodeBase64File(input.base64, this.options.maxUploadBytes);
    return validateUploadFile({
      bytes,
      fileName: input.fileName,
      mimeType: input.mimeType,
      maxBytes: this.options.maxUploadBytes,
    });
  }

  private createFormData(file: Pick<StagedUpload, 'bytes' | 'fileName' | 'mimeType'>): FormData {
    const formData = new FormData();
    const arrayBuffer = Uint8Array.from(file.bytes).buffer;
    formData.set('file', new Blob([arrayBuffer], { type: file.mimeType }), file.fileName);
    return formData;
  }

  private async mutate<T>(
    auth: AuthContext,
    action: string,
    targetType: 'document' | 'vault',
    targetId: string,
    invalidatedOperations: string[],
    operation: (client: D4SignClient) => Promise<T>,
  ): Promise<T> {
    const auditFields = {
      auditEvent: 'd4sign_file_operation',
      action,
      principalId: auth.principalId,
      tenantId: auth.tenantId,
      targetType,
      targetId,
    };
    this.options.logger.info({ ...auditFields, outcome: 'started' }, 'Operação de arquivo D4Sign iniciada');
    try {
      const credentials = await this.options.credentialProvider.getCredentials(auth);
      const client = this.createClient(credentials);
      const result = await operation(client);
      for (const cacheOperation of invalidatedOperations) {
        await this.options.cache.invalidate(
          cacheScope(auth.tenantId, client.accountFingerprint, cacheOperation),
        );
      }
      this.options.logger.info({ ...auditFields, outcome: 'succeeded' }, 'Operação de arquivo D4Sign concluída');
      return result;
    } catch (error) {
      this.options.logger.warn({ ...auditFields, outcome: 'failed' }, 'Operação de arquivo D4Sign falhou');
      throw error;
    }
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
