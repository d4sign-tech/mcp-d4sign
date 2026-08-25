import { createHash } from 'node:crypto';

import type { AuthContext } from '../auth/auth-context.js';
import type { CredentialProvider, D4SignCredentials } from '../auth/credential-provider.js';
import { D4SignClient } from '../d4sign/client.js';
import {
  parseAttachmentsResponse,
  parseDocumentResponse,
  parseDocumentsResponse,
  parseFoldersResponse,
  parseObserversResponse,
  parseSignersResponse,
  parseSignatureGroupDetailsResponse,
  parseSignatureGroupsResponse,
  parseTagsResponse,
  parseTemplatesResponse,
  parseUserVerificationResponse,
  parseVaultsResponse,
  parseWebhooksResponse,
} from '../d4sign/schemas.js';
import type {
  D4SignTemplate,
  DocumentAttachments,
  DocumentObservers,
  DocumentPage,
  DocumentSigners,
  DocumentSummary,
  DocumentTags,
  DocumentWebhooks,
  SignatureGroup,
  SignatureGroupDetails,
  UserVerification,
  Vault,
  VaultFolder,
} from '../d4sign/types.js';
import type { Cache } from '../infra/cache.js';
import type { AppLogger } from '../infra/logger.js';
import type { QuotaManager } from '../infra/quota-manager.js';

export interface D4SignReadServiceOptions {
  credentialProvider: CredentialProvider;
  cache: Cache;
  quotaManager: QuotaManager;
  logger: AppLogger;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
}

/**
 * Escopo de invalidação: tenant + conta D4Sign + operação. É a unidade que uma
 * mutação invalida, e o que o cache usa para compor a geração corrente.
 */
export function cacheScope(tenantId: string, accountFingerprint: string, operation: string): string {
  return `${tenantId}:${accountFingerprint}:${operation}`;
}

function argumentsKey(args: unknown): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}

function withDocumentLimit(page: DocumentPage, limit: number): DocumentPage {
  return { ...page, documents: page.documents.slice(0, limit) };
}

export class D4SignReadService {
  constructor(private readonly options: D4SignReadServiceOptions) {}

  async listVaults(auth: AuthContext, signal?: AbortSignal): Promise<Vault[]> {
    return this.cached(auth, 'vaults-list', {}, 5 * 60_000, async (client) =>
      parseVaultsResponse(
        await client.request({
          method: 'GET',
          path: '/safes',
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async listDocuments(
    auth: AuthContext,
    input: { page: number; limit: number },
    signal?: AbortSignal,
  ): Promise<DocumentPage> {
    const result = await this.cached(auth, 'documents-list', { page: input.page }, 60_000, async (client) =>
      parseDocumentsResponse(
        await client.request({
          method: 'GET',
          path: '/documents',
          query: { pg: input.page },
          ...(signal === undefined ? {} : { signal }),
        }),
        input.page,
        500,
      ),
    );
    return withDocumentLimit(result, input.limit);
  }

  async listVaultDocuments(
    auth: AuthContext,
    input: { vaultUuid: string; folderUuid?: string; page: number; limit: number },
    signal?: AbortSignal,
  ): Promise<DocumentPage> {
    const cacheArgs = {
      vaultUuid: input.vaultUuid,
      page: input.page,
      ...(input.folderUuid === undefined ? {} : { folderUuid: input.folderUuid }),
    };
    const result = await this.cached(auth, 'vault-documents-list', cacheArgs, 60_000, async (client) => {
      const encodedVault = encodeURIComponent(input.vaultUuid);
      const path = input.folderUuid === undefined
        ? `/documents/${encodedVault}/safe`
        : `/documents/${encodedVault}/safe/${encodeURIComponent(input.folderUuid)}`;
      return parseDocumentsResponse(
        await client.request({
          method: 'GET',
          path,
          query: { pg: input.page },
          ...(signal === undefined ? {} : { signal }),
        }),
        input.page,
        500,
      );
    });
    return withDocumentLimit(result, input.limit);
  }

  async listVaultFolders(
    auth: AuthContext,
    vaultUuid: string,
    signal?: AbortSignal,
  ): Promise<VaultFolder[]> {
    return this.cached(auth, 'vault-folders-list', { vaultUuid }, 5 * 60_000, async (client) =>
      parseFoldersResponse(
        await client.request({
          method: 'GET',
          path: `/folders/${encodeURIComponent(vaultUuid)}/find`,
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async getDocument(auth: AuthContext, documentUuid: string, signal?: AbortSignal): Promise<DocumentSummary> {
    return this.cached(auth, 'document-get', { documentUuid }, 15_000, async (client) =>
      parseDocumentResponse(
        await client.request({
          method: 'GET',
          path: `/documents/${encodeURIComponent(documentUuid)}`,
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async getDocumentFresh(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentSummary> {
    return this.uncached(auth, async (client) =>
      parseDocumentResponse(
        await client.request({
          method: 'GET',
          path: `/documents/${encodeURIComponent(documentUuid)}`,
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async listDocumentsByPhase(
    auth: AuthContext,
    input: { phaseId: number; page: number; limit: number },
    signal?: AbortSignal,
  ): Promise<DocumentPage> {
    const result = await this.cached(
      auth,
      'documents-list-by-phase',
      { phaseId: input.phaseId, page: input.page },
      60_000,
      async (client) =>
        parseDocumentsResponse(
          await client.request({
            method: 'GET',
            path: `/documents/${input.phaseId}/status`,
            query: { pg: input.page },
            ...(signal === undefined ? {} : { signal }),
          }),
          input.page,
          500,
        ),
    );
    return withDocumentLimit(result, input.limit);
  }

  async listTemplates(auth: AuthContext, signal?: AbortSignal): Promise<D4SignTemplate[]> {
    return this.cached(auth, 'templates-list', {}, 5 * 60_000, async (client) =>
      parseTemplatesResponse(
        await client.request({
          method: 'POST',
          path: '/templates',
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async listDocumentAttachments(
    auth: AuthContext,
    documentUuid: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<DocumentAttachments> {
    const result = await this.cached(
      auth,
      'document-attachments-list',
      { documentUuid },
      15_000,
      async (client) =>
        parseAttachmentsResponse(
          await client.request({
            method: 'GET',
            path: `/documents/${encodeURIComponent(documentUuid)}/listslaves`,
            ...(signal === undefined ? {} : { signal }),
          }),
          documentUuid,
          500,
        ),
    );
    return { ...result, attachments: result.attachments.slice(0, limit) };
  }

  async listDocumentSigners(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentSigners> {
    return this.cached(auth, 'document-signers-list', { documentUuid }, 15_000, async (client) =>
      parseSignersResponse(
        await client.request({
          method: 'GET',
          path: `/documents/${encodeURIComponent(documentUuid)}/list`,
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async listDocumentSignersFresh(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentSigners> {
    return this.uncached(auth, async (client) =>
      parseSignersResponse(
        await client.request({
          method: 'GET',
          path: `/documents/${encodeURIComponent(documentUuid)}/list`,
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async listSignatureGroups(
    auth: AuthContext,
    vaultUuid: string,
    signal?: AbortSignal,
  ): Promise<SignatureGroup[]> {
    return this.cached(auth, 'signature-groups-list', { vaultUuid }, 5 * 60_000, async (client) =>
      parseSignatureGroupsResponse(
        await client.request({
          method: 'GET',
          path: `/groups/${encodeURIComponent(vaultUuid)}`,
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async getSignatureGroup(
    auth: AuthContext,
    input: { vaultUuid: string; groupUuid: string },
    signal?: AbortSignal,
  ): Promise<SignatureGroupDetails> {
    return this.cached(auth, 'signature-group-get', input, 60_000, async (client) =>
      parseSignatureGroupDetailsResponse(
        await client.request({
          method: 'GET',
          path: `/groups/${encodeURIComponent(input.vaultUuid)}/groupdetails/${encodeURIComponent(input.groupUuid)}`,
          ...(signal === undefined ? {} : { signal }),
        }),
        input.vaultUuid,
        input.groupUuid,
      ),
    );
  }

  async verifyUser(auth: AuthContext, email: string, signal?: AbortSignal): Promise<UserVerification> {
    return this.cached(auth, 'user-verify', { email }, 15_000, async (client) =>
      parseUserVerificationResponse(
        await client.request({
          method: 'POST',
          path: '/users/check',
          body: { email_user: email },
          ...(signal === undefined ? {} : { signal }),
        }),
        email,
      ),
    );
  }

  async verifyUserFresh(
    auth: AuthContext,
    email: string,
    signal?: AbortSignal,
  ): Promise<UserVerification> {
    return this.uncached(auth, async (client) =>
      parseUserVerificationResponse(
        await client.request({
          method: 'POST',
          path: '/users/check',
          body: { email_user: email },
          ...(signal === undefined ? {} : { signal }),
        }),
        email,
      ),
    );
  }

  async listDocumentObservers(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentObservers> {
    return this.cached(auth, 'document-observers-list', { documentUuid }, 15_000, async (client) =>
      parseObserversResponse(
        await client.request({
          method: 'GET',
          path: `/watcher/${encodeURIComponent(documentUuid)}`,
          ...(signal === undefined ? {} : { signal }),
        }),
        documentUuid,
      ),
    );
  }

  async listDocumentObserversFresh(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentObservers> {
    return this.uncached(auth, async (client) =>
      parseObserversResponse(
        await client.request({
          method: 'GET',
          path: `/watcher/${encodeURIComponent(documentUuid)}`,
          ...(signal === undefined ? {} : { signal }),
        }),
        documentUuid,
      ),
    );
  }

  async listDocumentWebhooks(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentWebhooks> {
    return this.cached(auth, 'document-webhooks-list', { documentUuid }, 15_000, async (client) =>
      parseWebhooksResponse(
        await client.request({
          method: 'GET',
          path: `/documents/${encodeURIComponent(documentUuid)}/webhooks`,
          ...(signal === undefined ? {} : { signal }),
        }),
        documentUuid,
      ),
    );
  }

  async listDocumentTags(auth: AuthContext, documentUuid: string, signal?: AbortSignal): Promise<DocumentTags> {
    return this.cached(auth, 'document-tags-list', { documentUuid }, 15_000, async (client) =>
      parseTagsResponse(
        await client.request({
          method: 'GET',
          path: `/tags/${encodeURIComponent(documentUuid)}`,
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  async listDocumentTagsFresh(
    auth: AuthContext,
    documentUuid: string,
    signal?: AbortSignal,
  ): Promise<DocumentTags> {
    return this.uncached(auth, async (client) =>
      parseTagsResponse(
        await client.request({
          method: 'GET',
          path: `/tags/${encodeURIComponent(documentUuid)}`,
          ...(signal === undefined ? {} : { signal }),
        }),
      ),
    );
  }

  private async cached<T>(
    auth: AuthContext,
    operation: string,
    args: unknown,
    ttlMs: number,
    loader: (client: D4SignClient) => Promise<T>,
  ): Promise<T> {
    const credentials = await this.options.credentialProvider.getCredentials(auth);
    const client = this.createClient(credentials);
    return this.options.cache.getOrSet(
      cacheScope(auth.tenantId, client.accountFingerprint, operation),
      argumentsKey(args),
      ttlMs,
      () => loader(client),
    );
  }

  private async uncached<T>(
    auth: AuthContext,
    loader: (client: D4SignClient) => Promise<T>,
  ): Promise<T> {
    const credentials = await this.options.credentialProvider.getCredentials(auth);
    return loader(this.createClient(credentials));
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
