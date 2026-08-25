import { z } from 'zod/v4';

import { D4SignResponseError } from './errors.js';
import type {
  AddedSigner,
  BatchCreated,
  D4SignTemplate,
  DocumentAttachmentUploaded,
  DocumentAttachments,
  DocumentCancelled,
  DocumentCreatedFromTemplate,
  DocumentDownload,
  DocumentObserverAdded,
  DocumentObserverRemoved,
  DocumentObserversRemovedAll,
  DocumentObservers,
  DocumentSentForSignature,
  DocumentSignerInfoAdded,
  DocumentSignerMutation,
  DocumentSignersAdded,
  DocumentSignerUpdated,
  DocumentPage,
  DocumentSigners,
  DocumentSummary,
  DocumentTagAdded,
  DocumentTagRemoved,
  DocumentTags,
  DocumentTagsRemovedAll,
  DocumentUploaded,
  DocumentWebhooks,
  FolderCreated,
  FolderRenamed,
  SignatureGroup,
  SignatureGroupDetails,
  SignatureGroupMember,
  UserBlocked,
  UserUnblocked,
  UserVerification,
  SignerSummary,
  Vault,
  VaultFolder,
} from './types.js';

const uuid = z.uuid();
const optionalUpstreamString = z.union([z.string(), z.number(), z.null()]).optional();

const UpstreamVaultSchema = z
  .object({
    'uuid-safe': uuid.optional(),
    uuid_safe: uuid.optional(),
    'name-safe': z.string().min(1).max(1_024),
  })
  .loose()
  .superRefine((vault, ctx) => {
    const documentedUuid = vault['uuid-safe'];
    const observedUuid = vault.uuid_safe;
    if (documentedUuid === undefined && observedUuid === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'UUID do cofre ausente.',
      });
    }
    if (
      documentedUuid !== undefined
      && observedUuid !== undefined
      && documentedUuid !== observedUuid
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'UUIDs divergentes na resposta do cofre.',
      });
    }
  });

const UpstreamDocumentSchema = z
  .object({
    uuidDoc: uuid,
    nameDoc: z.string().min(1).max(2_048),
    type: z.string().max(256).nullable().optional(),
    size: optionalUpstreamString,
    pages: optionalUpstreamString,
    uuidSafe: uuid.nullable().optional(),
    safeName: z.string().max(1_024).nullable().optional(),
    statusId: optionalUpstreamString,
    statusName: z.string().max(512).nullable().optional(),
    statusComment: z.string().max(10_000).nullable().optional(),
    whoCanceled: z.string().max(1_024).nullable().optional(),
  })
  .loose();

const UpstreamPaginationSchema = z
  .object({
    total_documents: z.union([z.number(), z.string()]),
    total_in_this_page: z.union([z.number(), z.string()]).optional(),
    current_page: z.union([z.number(), z.string()]).optional(),
    total_pages: z.union([z.number(), z.string()]),
  })
  .loose();

const UpstreamSignerSchema = z
  .object({
    key_signer: z.string().min(1).max(512),
    user_name: z.string().max(1_024).nullable().optional(),
    email: z.string().max(512).nullable().optional(),
    signed: z.union([z.string(), z.number(), z.boolean()]).optional(),
    embed_methodauth: z.string().max(128).nullable().optional(),
    date: z.string().max(128).nullable().optional(),
  })
  .loose();

const UpstreamSignersResponseSchema = z
  .object({
    uuidDoc: uuid,
    list: z.union([UpstreamSignerSchema, z.array(UpstreamSignerSchema).max(1_000)]),
  })
  .loose();

const UpstreamTagsResponseSchema = z
  .object({
    uuid_arquivo: uuid,
    TAGs: z.string().max(100_000).nullable().optional(),
  })
  .loose();

const UpstreamFolderSchema = z
  .object({
    uuid_safe: uuid,
    uuid_folder: uuid,
    name: z.string().min(1).max(1_024),
    dt_cadastro: z.string().max(128).nullable().optional(),
  })
  .loose();

const UpstreamTemplateVariableListSchema = z.array(z.string().max(1_024)).max(2_000);

const UpstreamTemplateVariablesSchema = z.union([
  UpstreamTemplateVariableListSchema,
  z.record(
    z.string(),
    z.union([z.string().max(1_024), UpstreamTemplateVariableListSchema]),
  ),
]);

const UpstreamTemplateSchema = z
  .object({
    id: z.string().min(1).max(512),
    name: z.string().min(1).max(1_024),
    variables: UpstreamTemplateVariablesSchema.nullable().optional(),
  })
  .loose();

const upstreamFlag = z.union([z.string(), z.number(), z.boolean()]).optional();

const UpstreamSignatureGroupSchema = z
  .object({
    uuid_grupo: uuid,
    nome: z.string().min(1).max(1_024),
  })
  .loose();

const UpstreamSignatureGroupMemberSchema = z
  .object({
    uuid_conta: uuid,
    uuid_grupo: uuid,
    email: z.string().min(1).max(512),
    tipo_assinatura: optionalUpstreamString,
    nome_tipo_assinatura: z.string().max(512).nullable().optional(),
    sequencia: optionalUpstreamString,
    certificado_digital: upstreamFlag,
    doc_auth: upstreamFlag,
    doc_authselfie: upstreamFlag,
    assinatura_presencial: upstreamFlag,
    estrangeiro: upstreamFlag,
    removido: upstreamFlag,
    desativar_remocao: upstreamFlag,
    signatario_editavel: upstreamFlag,
    upload_permitido: upstreamFlag,
    upload_obs: z.string().max(10_000).nullable().optional(),
    clausula_destaque: upstreamFlag,
    dt_cadastro: z.string().max(128).nullable().optional(),
  })
  .loose();

const UpstreamSignatureGroupDetailsSchema = z
  .object({
    name_group: z.string().min(1).max(1_024),
    group_details: z.array(UpstreamSignatureGroupMemberSchema).max(1_000),
  })
  .loose();

const UpstreamUserVerificationSchema = z
  .object({
    user: z.string().min(1).max(512),
    status: z.string().min(1).max(128),
  })
  .loose();

const UpstreamObserverSchema = z
  .object({
    email: z.string().min(1).max(512),
    perfil: z.union([z.string(), z.number()]),
  })
  .loose();

const UpstreamObserversResponseSchema = z
  .object({
    uuid_arquivo: uuid,
    watchers: z.array(UpstreamObserverSchema).max(1_000).nullable().optional(),
  })
  .loose();

const UpstreamWebhookSchema = z
  .object({
    uuid,
    webhook_url: z.url().max(4_096),
  })
  .loose();

const UpstreamFolderCreatedSchema = z
  .object({
    message: z.string().min(1).max(1_024),
    uuid,
  })
  .loose();

const UpstreamMutationMessageSchema = z
  .object({
    message: z.string().min(1).max(1_024),
  })
  .loose();

const UpstreamTagAddedSchema = UpstreamMutationMessageSchema.extend({
  TAGs: z.string().min(1).max(1_024),
}).loose();

/**
 * Resposta das remoções de tag.
 *
 * Ao remover a última tag do documento, a D4Sign devolve a lista resultante
 * vazia (ou omite o campo). Exigir `TAGs` não vazio faria o parser rejeitar uma
 * mutação que já ocorreu, reportando falha para uma operação bem-sucedida.
 */
const UpstreamTagMutationSchema = UpstreamMutationMessageSchema.extend({
  TAGs: z.string().max(100_000).nullable().optional(),
  TAGS: z.string().max(100_000).nullable().optional(),
}).loose();

const UpstreamUrgentTagAddedSchema = UpstreamMutationMessageSchema.extend({
  TAGS: z.string().min(1).max(1_024),
}).loose();

const UpstreamObserverAddedSchema = UpstreamMutationMessageSchema.extend({
  uuid,
  watcher: z.string().min(1).max(512),
}).loose();

const UpstreamBatchCreatedSchema = z
  .object({
    message: z.string().min(1).max(1_024),
    uuid_batches: z.string().min(1).max(512),
    total: z.union([z.string(), z.number()]),
  })
  .loose();

const UpstreamUuidCreatedSchema = z.object({ uuid }).loose();

const UpstreamAddedSignerSchema = z
  .object({
    key_signer: z.string().min(1).max(256),
    email: z.string().min(1).max(320),
    status: z.string().min(1).max(128),
  })
  .loose();

const UpstreamSignerInfoSchema = z
  .object({
    'uuid-doc': uuid,
    email: z.string().min(1).max(320),
    name: z.string().max(512).nullable().optional(),
    status: z.string().min(1).max(128),
  })
  .loose();

const UpstreamObserverRemovedSchema = UpstreamMutationMessageSchema.extend({
  watcher: z.string().min(1).max(320),
}).loose();

const UpstreamDownloadSchema = z
  .object({
    url: z.url().max(4_096),
    name: z.string().min(1).max(512),
  })
  .loose();

function parseNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function textOrNull(value: string | number | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text.slice(0, maxLength);
}

function booleanFromUpstream(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function unwrapSingletonResponse(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  if (input.length !== 1) throw new D4SignResponseError();
  return input[0];
}

function normalizeDocument(value: z.infer<typeof UpstreamDocumentSchema>): DocumentSummary {
  return {
    uuid: value.uuidDoc,
    name: value.nameDoc.slice(0, 1_024),
    mimeType: textOrNull(value.type, 256),
    sizeBytes: parseNonNegativeInteger(value.size),
    pages: parseNonNegativeInteger(value.pages),
    vaultUuid: value.uuidSafe ?? null,
    vaultName: textOrNull(value.safeName, 512),
    statusId: textOrNull(value.statusId, 64),
    statusName: textOrNull(value.statusName, 256),
  };
}

export function parseVaultsResponse(input: unknown): Vault[] {
  const values = Array.isArray(input) ? input : [input];
  const parsed = z.array(UpstreamVaultSchema).max(1_000).safeParse(values);
  if (!parsed.success) throw new D4SignResponseError();
  return parsed.data.map((vault) => {
    const vaultUuid = vault['uuid-safe'] ?? vault.uuid_safe;
    if (vaultUuid === undefined) throw new D4SignResponseError();
    return {
      uuid: vaultUuid,
      name: vault['name-safe'].slice(0, 512),
    };
  });
}

export function parseDocumentResponse(input: unknown): DocumentSummary {
  const value = unwrapSingletonResponse(input);
  const parsed = UpstreamDocumentSchema.safeParse(value);
  if (!parsed.success) throw new D4SignResponseError();
  return normalizeDocument(parsed.data);
}

export function parseDocumentsResponse(input: unknown, page: number, limit: number): DocumentPage {
  if (!Array.isArray(input)) throw new D4SignResponseError();

  let pagination: z.infer<typeof UpstreamPaginationSchema> | undefined;
  const documents: DocumentSummary[] = [];

  for (const item of input) {
    const metadata = UpstreamPaginationSchema.safeParse(item);
    if (metadata.success) {
      if (pagination !== undefined) throw new D4SignResponseError();
      pagination = metadata.data;
      continue;
    }

    const document = UpstreamDocumentSchema.safeParse(item);
    if (!document.success) throw new D4SignResponseError();
    documents.push(normalizeDocument(document.data));
  }

  const totalDocuments = parseNonNegativeInteger(pagination?.total_documents);
  const totalPages = parseNonNegativeInteger(pagination?.total_pages);
  return {
    documents: documents.slice(0, limit),
    page,
    totalDocuments,
    totalPages,
    hasMore: totalPages === null ? null : page < totalPages,
  };
}

export function parseFoldersResponse(input: unknown): VaultFolder[] {
  const values = Array.isArray(input) ? input : [input];
  const parsed = z.array(UpstreamFolderSchema).max(2_000).safeParse(values);
  if (!parsed.success) throw new D4SignResponseError();
  return parsed.data.map((folder) => ({
    uuid: folder.uuid_folder,
    vaultUuid: folder.uuid_safe,
    name: folder.name.slice(0, 512),
    createdAt: textOrNull(folder.dt_cadastro, 64),
  }));
}

function normalizeTemplateVariables(
  variables: z.infer<typeof UpstreamTemplateVariablesSchema> | null | undefined,
): string[] {
  if (variables === null || variables === undefined) return [];
  const values = Array.isArray(variables)
    ? variables
    : Object.values(variables).flatMap((value) => (Array.isArray(value) ? value : [value]));
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((value) => value.slice(0, 256));
}

export function parseTemplatesResponse(input: unknown): D4SignTemplate[] {
  let values: unknown[];
  if (Array.isArray(input)) {
    values = input;
  } else if (input !== null && typeof input === 'object') {
    values = UpstreamTemplateSchema.safeParse(input).success ? [input] : Object.values(input);
  } else {
    values = [input];
  }
  const parsed = z.array(UpstreamTemplateSchema).max(2_000).safeParse(values);
  if (!parsed.success) throw new D4SignResponseError();
  return parsed.data.map((template) => ({
    id: template.id.slice(0, 256),
    name: template.name.slice(0, 512),
    variables: normalizeTemplateVariables(template.variables),
  }));
}

export function parseAttachmentsResponse(
  input: unknown,
  documentUuid: string,
  limit: number,
): DocumentAttachments {
  const page = parseDocumentsResponse(input, 1, limit);
  return {
    documentUuid,
    attachments: page.documents,
    totalAttachments: page.totalDocuments ?? page.documents.length,
    totalPages: page.totalPages,
  };
}

function normalizeSigner(value: z.infer<typeof UpstreamSignerSchema>): SignerSummary {
  return {
    keySigner: value.key_signer.slice(0, 256),
    name: textOrNull(value.user_name, 512),
    email: textOrNull(value.email, 320),
    signed: booleanFromUpstream(value.signed),
    authenticationMethod: textOrNull(value.embed_methodauth, 128),
    addedAt: textOrNull(value.date, 64),
  };
}

export function parseSignersResponse(input: unknown): DocumentSigners {
  const value = unwrapSingletonResponse(input);
  const parsed = UpstreamSignersResponseSchema.safeParse(value);
  if (!parsed.success) throw new D4SignResponseError();
  const list = Array.isArray(parsed.data.list) ? parsed.data.list : [parsed.data.list];
  return {
    documentUuid: parsed.data.uuidDoc,
    signers: list.map(normalizeSigner),
  };
}

export function parseTagsResponse(input: unknown): DocumentTags {
  // Mesma tolerância defensiva das outras listagens: a D4Sign já mudou a forma
  // de resposta em produção sem aviso (ver docs/api-contract-notes.md).
  const parsed = UpstreamTagsResponseSchema.safeParse(unwrapSingletonResponse(input));
  if (!parsed.success) throw new D4SignResponseError();
  const tags = (parsed.data.TAGs ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 500)
    .map((tag) => tag.slice(0, 256));

  return { documentUuid: parsed.data.uuid_arquivo, tags };
}

export function parseSignatureGroupsResponse(input: unknown): SignatureGroup[] {
  const values = Array.isArray(input) ? input : [input];
  const parsed = z.array(UpstreamSignatureGroupSchema).max(1_000).safeParse(values);
  if (!parsed.success) throw new D4SignResponseError();
  return parsed.data.map((group) => ({
    uuid: group.uuid_grupo,
    name: group.nome.slice(0, 512),
  }));
}

function normalizeSignatureGroupMember(
  value: z.infer<typeof UpstreamSignatureGroupMemberSchema>,
): SignatureGroupMember {
  return {
    accountUuid: value.uuid_conta,
    groupUuid: value.uuid_grupo,
    email: value.email.slice(0, 320),
    signatureTypeId: textOrNull(value.tipo_assinatura, 64),
    signatureTypeName: textOrNull(value.nome_tipo_assinatura, 256),
    sequence: parseNonNegativeInteger(value.sequencia),
    requiresDigitalCertificate: booleanFromUpstream(value.certificado_digital),
    requiresDocumentAuthentication: booleanFromUpstream(value.doc_auth),
    requiresDocumentAndSelfie: booleanFromUpstream(value.doc_authselfie),
    inPerson: booleanFromUpstream(value.assinatura_presencial),
    foreign: booleanFromUpstream(value.estrangeiro),
    removed: booleanFromUpstream(value.removido),
    removalDisabled: booleanFromUpstream(value.desativar_remocao),
    editable: booleanFromUpstream(value.signatario_editavel),
    uploadAllowed: booleanFromUpstream(value.upload_permitido),
    uploadInstructions: textOrNull(value.upload_obs, 2_000),
    highlightedClause: booleanFromUpstream(value.clausula_destaque),
    createdAt: textOrNull(value.dt_cadastro, 64),
  };
}

export function parseSignatureGroupDetailsResponse(
  input: unknown,
  vaultUuid: string,
  groupUuid: string,
): SignatureGroupDetails {
  const parsed = UpstreamSignatureGroupDetailsSchema.safeParse(input);
  if (!parsed.success) throw new D4SignResponseError();
  if (parsed.data.group_details.some((member) => member.uuid_grupo !== groupUuid)) {
    throw new D4SignResponseError();
  }
  return {
    vaultUuid,
    groupUuid,
    name: parsed.data.name_group.slice(0, 512),
    members: parsed.data.group_details.map(normalizeSignatureGroupMember),
  };
}

export function parseUserVerificationResponse(input: unknown, requestedEmail?: string): UserVerification {
  const parsed = UpstreamUserVerificationSchema.safeParse(unwrapSingletonResponse(input));
  if (!parsed.success) {
    // Usuário inexistente ou fora de domínio validado: a D4Sign responde apenas
    // com uma mensagem. É um resultado legítimo, não resposta fora de contrato.
    if (requestedEmail !== undefined && UpstreamMutationMessageSchema.safeParse(input).success) {
      return { email: requestedEmail.slice(0, 320), status: 'not_found' };
    }
    throw new D4SignResponseError();
  }
  return {
    email: parsed.data.user.slice(0, 320),
    status: parsed.data.status.slice(0, 128),
  };
}

export function parseObserversResponse(input: unknown, documentUuid: string): DocumentObservers {
  const parsed = UpstreamObserversResponseSchema.safeParse(input);
  if (!parsed.success || parsed.data.uuid_arquivo !== documentUuid) throw new D4SignResponseError();
  return {
    documentUuid,
    observers: (parsed.data.watchers ?? []).map((watcher) => ({
      email: watcher.email.slice(0, 320),
      profile: String(watcher.perfil).slice(0, 64),
    })),
  };
}

export function parseWebhooksResponse(input: unknown, documentUuid: string): DocumentWebhooks {
  // Documento sem webhook é o caso comum: a D4Sign responde lista vazia, corpo
  // ausente ou apenas uma mensagem. Nenhum deles é violação de contrato.
  if (input === undefined || input === null) return { documentUuid, webhooks: [] };
  if (Array.isArray(input) && input.length === 0) return { documentUuid, webhooks: [] };
  if (!Array.isArray(input) && UpstreamMutationMessageSchema.safeParse(input).success) {
    return { documentUuid, webhooks: [] };
  }
  const values = Array.isArray(input) ? input : [input];
  const parsed = z.array(UpstreamWebhookSchema).max(100).safeParse(values);
  if (!parsed.success) throw new D4SignResponseError();
  if (parsed.data.some((webhook) => webhook.uuid !== documentUuid)) {
    throw new D4SignResponseError();
  }
  return {
    documentUuid,
    webhooks: parsed.data.map((webhook) => ({ url: webhook.webhook_url })),
  };
}

export function parseFolderCreatedResponse(
  input: unknown,
  expected: { vaultUuid: string; parentFolderUuid?: string; folderName: string },
): FolderCreated {
  const parsed = UpstreamFolderCreatedSchema.safeParse(input);
  if (!parsed.success) throw new D4SignResponseError();
  return {
    success: true,
    vaultUuid: expected.vaultUuid,
    folderUuid: parsed.data.uuid,
    parentFolderUuid: expected.parentFolderUuid ?? null,
    folderName: expected.folderName,
  };
}

export function parseFolderRenamedResponse(
  input: unknown,
  expected: { vaultUuid: string; folderUuid: string; folderName: string },
): FolderRenamed {
  const parsed = UpstreamMutationMessageSchema.safeParse(input);
  if (!parsed.success) throw new D4SignResponseError();
  return { success: true, ...expected };
}

export function parseTagAddedResponse(
  input: unknown,
  expected: { documentUuid: string; tag: string },
): DocumentTagAdded {
  const parsed = UpstreamTagAddedSchema.safeParse(input);
  if (!parsed.success) throw new D4SignResponseError();
  return { success: true, ...expected };
}

export function parseUrgentTagAddedResponse(input: unknown, documentUuid: string): DocumentTagAdded {
  const parsed = UpstreamUrgentTagAddedSchema.safeParse(input);
  if (!parsed.success) throw new D4SignResponseError();
  return { success: true, documentUuid, tag: 'URGENTE' };
}

export function parseObserverAddedResponse(
  input: unknown,
  expected: { documentUuid: string; email: string; permission: '0' | '1' },
): DocumentObserverAdded {
  const parsed = UpstreamObserverAddedSchema.safeParse(input);
  if (
    !parsed.success
    || parsed.data.uuid !== expected.documentUuid
    || parsed.data.watcher.toLocaleLowerCase() !== expected.email.toLocaleLowerCase()
  ) {
    throw new D4SignResponseError();
  }
  return { success: true, ...expected };
}

export function parseDocumentSentResponse(
  input: unknown,
  expected: {
    documentUuid: string;
    notifySigners: boolean;
    workflow: 'simultaneous' | 'ordered';
    signLimitDate?: string;
  },
): DocumentSentForSignature {
  if (input !== undefined && !UpstreamMutationMessageSchema.safeParse(input).success) {
    throw new D4SignResponseError();
  }
  return {
    success: true,
    documentUuid: expected.documentUuid,
    notifySigners: expected.notifySigners,
    workflow: expected.workflow,
    signLimitDate: expected.signLimitDate ?? null,
  };
}

export function parseDocumentCancelledResponse(input: unknown, documentUuid: string): DocumentCancelled {
  if (UpstreamMutationMessageSchema.safeParse(input).success) {
    return { success: true, documentUuid };
  }
  const document = parseDocumentResponse(input);
  if (document.uuid !== documentUuid || document.statusId !== '6') throw new D4SignResponseError();
  return { success: true, documentUuid };
}

export function parseDocumentSignerMutationResponse(
  input: unknown,
  expected: { documentUuid: string; email: string; keySigner: string },
): DocumentSignerMutation {
  if (!UpstreamMutationMessageSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, ...expected };
}

export function parseUserBlockedResponse(input: unknown, email: string): UserBlocked {
  if (!UpstreamMutationMessageSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, email };
}

export function parseBatchCreatedResponse(input: unknown, documentUuids: string[]): BatchCreated {
  const parsed = UpstreamBatchCreatedSchema.safeParse(input);
  const total = parsed.success ? parseNonNegativeInteger(parsed.data.total) : null;
  if (!parsed.success || total === null || total !== documentUuids.length) {
    throw new D4SignResponseError();
  }
  return {
    success: true,
    batchId: parsed.data.uuid_batches,
    totalDocuments: total,
    documentUuids,
  };
}

export function parseDocumentCreatedFromTemplateResponse(
  input: unknown,
  expected: {
    vaultUuid: string;
    folderUuid?: string;
    templateCount: number;
    templateKind: 'html' | 'word';
  },
): DocumentCreatedFromTemplate {
  const parsed = UpstreamUuidCreatedSchema.safeParse(input);
  if (!parsed.success) throw new D4SignResponseError();
  return {
    success: true,
    documentUuid: parsed.data.uuid,
    vaultUuid: expected.vaultUuid,
    folderUuid: expected.folderUuid ?? null,
    templateCount: expected.templateCount,
    templateKind: expected.templateKind,
  };
}

function normalizeAddedSigner(value: z.infer<typeof UpstreamAddedSignerSchema>): AddedSigner {
  return {
    email: value.email.toLocaleLowerCase(),
    keySigner: value.key_signer,
    status: value.status,
  };
}

export function parseDocumentSignersAddedResponse(
  input: unknown,
  expected: { documentUuid: string; requestedEmails: string[] },
): DocumentSignersAdded {
  const values = Array.isArray(input) ? input : [input];
  const parsed = z.array(UpstreamAddedSignerSchema).min(1).max(25).safeParse(values);
  if (!parsed.success) throw new D4SignResponseError();
  const requested = new Set(expected.requestedEmails.map((email) => email.toLocaleLowerCase()));
  if (parsed.data.some((signer) => !requested.has(signer.email.toLocaleLowerCase()))) {
    throw new D4SignResponseError();
  }
  return {
    success: true,
    documentUuid: expected.documentUuid,
    requestedCount: expected.requestedEmails.length,
    signers: parsed.data.map(normalizeAddedSigner),
  };
}

export function parseDocumentSignerUpdatedResponse(
  input: unknown,
  expected: { documentUuid: string; previousEmail: string; newEmail: string; keySigner: string },
): DocumentSignerUpdated {
  if (!UpstreamMutationMessageSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, ...expected };
}

export function parseDocumentSignerInfoAddedResponse(
  input: unknown,
  expected: { documentUuid: string; email: string; keySigner: string },
): DocumentSignerInfoAdded {
  const parsed = UpstreamSignerInfoSchema.safeParse(input);
  if (
    !parsed.success
    || parsed.data['uuid-doc'] !== expected.documentUuid
    || parsed.data.email.toLocaleLowerCase() !== expected.email.toLocaleLowerCase()
  ) {
    throw new D4SignResponseError();
  }
  return {
    success: true,
    documentUuid: expected.documentUuid,
    email: expected.email,
    keySigner: expected.keySigner,
    displayName: textOrNull(parsed.data.name, 512),
    status: parsed.data.status,
  };
}

export function parseUserUnblockedResponse(input: unknown, email: string): UserUnblocked {
  if (!UpstreamMutationMessageSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, email };
}

export function parseTagRemovedResponse(
  input: unknown,
  expected: { documentUuid: string; tag: string },
): DocumentTagRemoved {
  if (!UpstreamTagMutationSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, ...expected };
}

export function parseAllTagsRemovedResponse(
  input: unknown,
  documentUuid: string,
  removedCount: number,
): DocumentTagsRemovedAll {
  if (!UpstreamMutationMessageSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, documentUuid, removedCount };
}

export function parseUrgentTagRemovedResponse(input: unknown, documentUuid: string): DocumentTagRemoved {
  if (!UpstreamTagMutationSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, documentUuid, tag: 'URGENTE' };
}

export function parseObserverRemovedResponse(
  input: unknown,
  expected: { documentUuid: string; email: string },
): DocumentObserverRemoved {
  const parsed = UpstreamObserverRemovedSchema.safeParse(input);
  if (
    !parsed.success
    || parsed.data.watcher.toLocaleLowerCase() !== expected.email.toLocaleLowerCase()
  ) {
    throw new D4SignResponseError();
  }
  return { success: true, ...expected };
}

export function parseAllObserversRemovedResponse(
  input: unknown,
  documentUuid: string,
  removedCount: number,
): DocumentObserversRemovedAll {
  if (!UpstreamMutationMessageSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, documentUuid, removedCount };
}

export function parseDocumentUploadedResponse(
  input: unknown,
  expected: Omit<DocumentUploaded, 'success' | 'documentUuid' | 'processing'>,
): DocumentUploaded {
  const parsed = UpstreamUuidCreatedSchema.safeParse(input);
  if (!parsed.success) throw new D4SignResponseError();
  return {
    success: true,
    documentUuid: parsed.data.uuid,
    ...expected,
    processing: true,
  };
}

export function parseDocumentAttachmentUploadedResponse(
  input: unknown,
  expected: Omit<DocumentAttachmentUploaded, 'success' | 'processing'>,
): DocumentAttachmentUploaded {
  if (!UpstreamMutationMessageSchema.safeParse(input).success) throw new D4SignResponseError();
  return { success: true, ...expected, processing: true };
}

export function parseDocumentDownloadResponse(
  input: unknown,
  expected: Omit<DocumentDownload, 'name' | 'url'>,
): DocumentDownload {
  const parsed = UpstreamDownloadSchema.safeParse(input);
  if (!parsed.success) throw new D4SignResponseError();
  const url = new URL(parsed.data.url);
  const queryKeys = [...url.searchParams.keys()].map((key) => key.toLocaleLowerCase());
  if (url.protocol !== 'https:' || queryKeys.includes('tokenapi') || queryKeys.includes('cryptkey')) {
    throw new D4SignResponseError('A D4Sign retornou uma URL de download insegura.');
  }
  return { ...expected, name: parsed.data.name, url: parsed.data.url };
}
