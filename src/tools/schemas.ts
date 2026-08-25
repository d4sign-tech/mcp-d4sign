import { z } from 'zod/v4';

export const EmptyInputSchema = z.object({}).strict();

export const DocumentUuidInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID interno exato do documento D4Sign'),
  })
  .strict();

const LocalLimitSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20)
  .describe('Quantidade máxima de itens devolvida ao cliente MCP');

const PageSchema = z.number().int().min(1).max(10_000).default(1).describe('Página D4Sign solicitada');

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
}

const FolderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => !hasControlCharacters(value), 'O nome da pasta contém caracteres de controle.');

const TagNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) => !hasControlCharacters(value) && !value.includes(','),
    'Envie uma única tag sem vírgulas ou caracteres de controle.',
  );

const SafeOptionalTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(5_000)
  .refine((value) => !hasControlCharacters(value), 'O texto contém caracteres de controle.');

const EmailSchema = z.email().max(320).transform((value) => value.toLocaleLowerCase());

function isValidShortDate(value: string): boolean {
  const [dayText, monthText, yearText] = value.split('-');
  const day = Number(dayText);
  const month = Number(monthText);
  const year = 2_000 + Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const DocumentsListInputSchema = z
  .object({
    page: PageSchema,
    limit: LocalLimitSchema,
  })
  .strict();

export const VaultDocumentsListInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID interno exato do cofre D4Sign'),
    folderUuid: z.uuid().optional().describe('UUID exato da pasta para restringir a listagem'),
    page: PageSchema,
    limit: LocalLimitSchema,
  })
  .strict();

export const VaultFoldersListInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID interno exato do cofre D4Sign'),
    limit: LocalLimitSchema,
  })
  .strict();

export const DocumentsByPhaseInputSchema = z
  .object({
    phaseId: z
      .number()
      .int()
      .min(1)
      .max(7)
      .describe('Fase: 1 processando, 2 aguardando signatários, 3 aguardando assinaturas, 4 finalizado, 5 arquivado, 6 cancelado, 7 editando'),
    page: PageSchema,
    limit: LocalLimitSchema,
  })
  .strict();

export const TemplatesListInputSchema = z.object({ limit: LocalLimitSchema }).strict();

export const DocumentAttachmentsInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID interno exato do documento principal D4Sign'),
    limit: LocalLimitSchema,
  })
  .strict();

export const SignatureGroupsInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID interno exato do cofre D4Sign'),
    limit: LocalLimitSchema,
  })
  .strict();

export const SignatureGroupInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID interno exato do cofre D4Sign'),
    groupUuid: z.uuid().describe('UUID interno exato do grupo de assinatura D4Sign'),
    limit: LocalLimitSchema.describe('Quantidade máxima de membros devolvida ao cliente MCP'),
  })
  .strict();

export const UserVerifyInputSchema = z
  .object({
    // Mesma normalização das demais tools: sem isso a mesma consulta em caixa
    // diferente gera chave de cache distinta e consome cota duas vezes.
    email: EmailSchema.describe('E-mail do usuário do domínio validado na D4Sign'),
  })
  .strict();

export const DocumentObserversInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID interno exato do documento D4Sign'),
    limit: LocalLimitSchema,
  })
  .strict();

export const VaultFolderCreateInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID interno exato do cofre D4Sign'),
    parentFolderUuid: z.uuid().optional().describe('UUID exato da pasta pai; omita para criar na raiz'),
    folderName: FolderNameSchema.describe('Nome exato da nova pasta ou subpasta'),
  })
  .strict();

export const VaultFolderRenameInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID interno exato do cofre D4Sign'),
    folderUuid: z.uuid().describe('UUID exato da pasta ou subpasta a renomear'),
    folderName: FolderNameSchema.describe('Novo nome exato da pasta ou subpasta'),
  })
  .strict();

export const DocumentTagAddInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID interno exato do documento D4Sign'),
    tag: TagNameSchema.describe('Uma única tag a adicionar ao documento'),
  })
  .strict();

export const DocumentObserverAddInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID interno exato do documento D4Sign'),
    email: EmailSchema.describe('E-mail exato do novo observador'),
    permission: z
      .enum(['0', '1'])
      .default('1')
      .describe('0: perfil básico com download; 1: somente visualização sem download'),
  })
  .strict();

export const DocumentSendForSignatureInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID interno exato do documento D4Sign'),
    notifySigners: z
      .boolean()
      .default(true)
      .describe('Envia os e-mails de assinatura da D4Sign quando verdadeiro'),
    followSigningOrder: z
      .boolean()
      .default(false)
      .describe('Exige a ordem configurada dos signatários quando verdadeiro'),
    message: SafeOptionalTextSchema.optional().describe('Mensagem opcional incluída no envio'),
    signLimitDate: z
      .string()
      .regex(/^\d{2}-\d{2}-\d{2}$/, 'Use DD-MM-AA.')
      .refine(isValidShortDate, 'Informe uma data válida no formato DD-MM-AA.')
      .optional()
      .describe('Data-limite opcional no formato DD-MM-AA exigido pela D4Sign'),
  })
  .strict();

export const DocumentCancelInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID interno exato do documento D4Sign'),
    comment: SafeOptionalTextSchema.optional().describe('Motivo opcional do cancelamento'),
  })
  .strict();

export const DocumentSignerMutationInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID interno exato do documento D4Sign'),
    email: EmailSchema.describe('E-mail exato do signatário'),
    keySigner: z.string().trim().min(1).max(256).describe('Chave exata do signatário no documento'),
  })
  .strict();

export const UserBlockInputSchema = z
  .object({
    email: EmailSchema.describe('E-mail exato do usuário do domínio validado na D4Sign'),
  })
  .strict();

export const VaultOutputSchema = z
  .object({
    uuid: z.uuid(),
    name: z.string().min(1).max(512),
  })
  .strict();

export const VaultsListOutputSchema = z
  .object({
    vaults: z.array(VaultOutputSchema).max(1_000),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const DocumentOutputSchema = z
  .object({
    uuid: z.uuid(),
    name: z.string().min(1).max(1_024),
    mimeType: z.string().max(256).nullable(),
    sizeBytes: z.number().int().nonnegative().nullable(),
    pages: z.number().int().nonnegative().nullable(),
    vaultUuid: z.uuid().nullable(),
    vaultName: z.string().max(512).nullable(),
    statusId: z.string().max(64).nullable(),
    statusName: z.string().max(256).nullable(),
  })
  .strict();

export const DocumentsListOutputSchema = z
  .object({
    documents: z.array(DocumentOutputSchema).max(100),
    page: z.number().int().min(1),
    returned: z.number().int().nonnegative().max(100),
    totalDocuments: z.number().int().nonnegative().nullable(),
    totalPages: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean().nullable(),
  })
  .strict();

export const VaultDocumentsListOutputSchema = DocumentsListOutputSchema.extend({
  vaultUuid: z.uuid(),
  folderUuid: z.uuid().nullable(),
});

export const DocumentsByPhaseOutputSchema = DocumentsListOutputSchema.extend({
  phaseId: z.number().int().min(1).max(7),
});

export const FolderOutputSchema = z
  .object({
    uuid: z.uuid(),
    vaultUuid: z.uuid(),
    name: z.string().min(1).max(512),
    createdAt: z.string().max(64).nullable(),
  })
  .strict();

export const VaultFoldersListOutputSchema = z
  .object({
    vaultUuid: z.uuid(),
    folders: z.array(FolderOutputSchema).max(100),
    count: z.number().int().nonnegative().max(100),
    truncated: z.boolean(),
  })
  .strict();

export const TemplateOutputSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(512),
    variables: z.array(z.string().min(1).max(256)).max(500),
  })
  .strict();

export const TemplatesListOutputSchema = z
  .object({
    templates: z.array(TemplateOutputSchema).max(100),
    count: z.number().int().nonnegative().max(100),
    truncated: z.boolean(),
  })
  .strict();

export const DocumentAttachmentsOutputSchema = z
  .object({
    documentUuid: z.uuid(),
    attachments: z.array(DocumentOutputSchema).max(100),
    returned: z.number().int().nonnegative().max(100),
    totalAttachments: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
  })
  .strict();

export const DocumentGetOutputSchema = z.object({ document: DocumentOutputSchema }).strict();

export const SignerOutputSchema = z
  .object({
    keySigner: z.string().min(1).max(256),
    name: z.string().max(512).nullable(),
    email: z.string().max(320).nullable(),
    signed: z.boolean(),
    authenticationMethod: z.string().max(128).nullable(),
    addedAt: z.string().max(64).nullable(),
  })
  .strict();

export const DocumentSignersOutputSchema = z
  .object({
    documentUuid: z.uuid(),
    signers: z.array(SignerOutputSchema).max(1_000),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const DocumentTagsOutputSchema = z
  .object({
    documentUuid: z.uuid(),
    tags: z.array(z.string().min(1).max(256)).max(500),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const SignatureGroupOutputSchema = z
  .object({
    uuid: z.uuid(),
    name: z.string().min(1).max(512),
  })
  .strict();

export const SignatureGroupsListOutputSchema = z
  .object({
    vaultUuid: z.uuid(),
    groups: z.array(SignatureGroupOutputSchema).max(100),
    count: z.number().int().nonnegative().max(100),
    truncated: z.boolean(),
  })
  .strict();

export const SignatureGroupMemberOutputSchema = z
  .object({
    accountUuid: z.uuid(),
    groupUuid: z.uuid(),
    email: z.string().min(1).max(320),
    signatureTypeId: z.string().max(64).nullable(),
    signatureTypeName: z.string().max(256).nullable(),
    sequence: z.number().int().nonnegative().nullable(),
    requiresDigitalCertificate: z.boolean(),
    requiresDocumentAuthentication: z.boolean(),
    requiresDocumentAndSelfie: z.boolean(),
    inPerson: z.boolean(),
    foreign: z.boolean(),
    removed: z.boolean(),
    removalDisabled: z.boolean(),
    editable: z.boolean(),
    uploadAllowed: z.boolean(),
    uploadInstructions: z.string().max(2_000).nullable(),
    highlightedClause: z.boolean(),
    createdAt: z.string().max(64).nullable(),
  })
  .strict();

export const SignatureGroupDetailsOutputSchema = z
  .object({
    vaultUuid: z.uuid(),
    groupUuid: z.uuid(),
    name: z.string().min(1).max(512),
    members: z.array(SignatureGroupMemberOutputSchema).max(100),
    count: z.number().int().nonnegative().max(100),
    truncated: z.boolean(),
  })
  .strict();

export const UserVerifyOutputSchema = z
  .object({
    email: z.string().min(1).max(320),
    status: z.string().min(1).max(128),
  })
  .strict();

export const DocumentObserverOutputSchema = z
  .object({
    email: z.string().min(1).max(320),
    profile: z.string().max(64),
  })
  .strict();

export const DocumentObserversOutputSchema = z
  .object({
    documentUuid: z.uuid(),
    observers: z.array(DocumentObserverOutputSchema).max(100),
    count: z.number().int().nonnegative().max(100),
    truncated: z.boolean(),
  })
  .strict();

export const DocumentWebhookOutputSchema = z
  .object({
    url: z.url().max(4_096),
  })
  .strict();

export const DocumentWebhooksOutputSchema = z
  .object({
    documentUuid: z.uuid(),
    webhooks: z.array(DocumentWebhookOutputSchema).max(100),
    count: z.number().int().nonnegative().max(100),
  })
  .strict();

export const VaultFolderCreatedOutputSchema = z
  .object({
    success: z.literal(true),
    vaultUuid: z.uuid(),
    folderUuid: z.uuid(),
    parentFolderUuid: z.uuid().nullable(),
    folderName: z.string().min(1).max(512),
  })
  .strict();

export const VaultFolderRenamedOutputSchema = z
  .object({
    success: z.literal(true),
    vaultUuid: z.uuid(),
    folderUuid: z.uuid(),
    folderName: z.string().min(1).max(512),
  })
  .strict();

export const DocumentTagAddedOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    tag: z.string().min(1).max(256),
  })
  .strict();

export const DocumentObserverAddedOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    email: z.string().min(1).max(320),
    permission: z.enum(['0', '1']),
  })
  .strict();

export const DocumentSentForSignatureOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    notifySigners: z.boolean(),
    workflow: z.enum(['simultaneous', 'ordered']),
    signLimitDate: z.string().nullable(),
  })
  .strict();

export const DocumentCancelledOutputSchema = z
  .object({ success: z.literal(true), documentUuid: z.uuid() })
  .strict();

export const DocumentSignerMutationOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    email: z.string().min(1).max(320),
    keySigner: z.string().min(1).max(256),
  })
  .strict();

export const UserBlockedOutputSchema = z
  .object({ success: z.literal(true), email: z.string().min(1).max(320) })
  .strict();

const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !hasControlCharacters(value) && !value.includes('/') && !value.includes('\\'),
    'Use somente o nome do arquivo, sem caminho ou caracteres de controle.',
  );

const UploadMimeTypeSchema = z.enum([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/bmp',
]);

export const BatchCreateInputSchema = z
  .object({
    documentUuids: z
      .array(z.uuid().describe('UUID exato de um documento D4Sign'))
      .min(1)
      .max(25)
      .refine((values) => new Set(values).size === values.length, 'Não repita documentos no lote.'),
  })
  .strict();

export const DocumentUploadInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID exato do cofre de destino'),
    folderUuid: z.uuid().optional().describe('UUID exato da pasta de destino'),
    uploadHandle: z.uuid().describe('Handle temporário devolvido por POST /uploads'),
    followSigningOrder: z.boolean().optional().describe('Define o workflow inicial do documento'),
  })
  .strict();

export const DocumentAttachmentUploadInputSchema = z
  .object({
    mainDocumentUuid: z.uuid().describe('UUID exato do documento principal'),
    uploadHandle: z.uuid().describe('Handle temporário devolvido por POST /uploads'),
  })
  .strict();

/**
 * Teto do conteúdo base64 aceito nas tools binárias.
 *
 * Precisa caber no corpo JSON-RPC aceito pelo transporte (`MCP_MAX_BODY_BYTES`,
 * padrão 2 MiB): anunciar um limite maior que o transporte só produziria um 413
 * fora do contrato de erro semântico. Arquivos acima disso usam `POST /uploads`.
 */
export const MAX_INLINE_BASE64_CHARS = 1_400_000;

const BinaryFileFields = {
  base64: z
    .string()
    .min(4)
    .max(MAX_INLINE_BASE64_CHARS)
    .describe(
      'Conteúdo base64 puro, sem prefixo data URI, de até ~1 MiB decodificado. Para arquivos maiores use POST /uploads e a tool por uploadHandle.',
    ),
  fileName: FileNameSchema.describe('Nome do arquivo com extensão coerente'),
  mimeType: UploadMimeTypeSchema.describe('MIME declarado e validado contra o conteúdo real'),
};

export const DocumentBinaryUploadInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID exato do cofre de destino'),
    folderUuid: z.uuid().optional().describe('UUID exato da pasta de destino'),
    ...BinaryFileFields,
  })
  .strict();

export const DocumentAttachmentBinaryUploadInputSchema = z
  .object({
    mainDocumentUuid: z.uuid().describe('UUID exato do documento principal'),
    ...BinaryFileFields,
  })
  .strict();

export const DocumentDownloadInputSchema = z
  .object({
    documentUuid: z.uuid().describe('UUID exato do documento'),
    type: z.enum(['pdf', 'pdfa', 'zip']).default('pdf'),
    language: z.enum(['pt', 'en']).default('pt'),
    includeSignerDocuments: z.boolean().default(false),
    includeVideoSelfieFrames: z.boolean().default(false),
  })
  .strict();

const TemplateVariablesSchema = z
  .record(
    z.string().trim().min(1).max(256),
    z.string().max(20_000).refine((value) => !hasControlCharacters(value), 'Valor contém caracteres de controle.'),
  )
  .refine((value) => Object.keys(value).length <= 200, 'Um template aceita no máximo 200 variáveis.');

export const TemplateDocumentCreateInputSchema = z
  .object({
    vaultUuid: z.uuid().describe('UUID exato do cofre de destino'),
    folderUuid: z.uuid().optional().describe('UUID exato da pasta de destino'),
    documentName: FileNameSchema.describe('Nome do documento a criar'),
    templates: z
      .array(
        z
          .object({
            templateId: z.string().trim().min(1).max(256),
            variables: TemplateVariablesSchema,
          })
          .strict(),
      )
      .min(1)
      .max(25)
      .refine(
        (templates) => new Set(templates.map((template) => template.templateId)).size === templates.length,
        'Não repita templateId.',
      ),
  })
  .strict();

const PhoneSchema = z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).max(16);

const SignerCreateSchema = z
  .object({
    email: EmailSchema,
    action: z.number().int().min(1).max(13).describe('Código de ação D4Sign entre 1 e 13'),
    foreign: z.boolean().default(false),
    foreignLanguage: z.enum(['en', 'es', 'pt', 'it', 'de']).optional(),
    requiresIcpBrasil: z.boolean().default(false),
    icpBrasilCertificateType: z.enum(['1', '2']).optional(),
    icpBrasilCpf: z.string().regex(/^\d{11}$/).optional(),
    icpBrasilCnpj: z.string().regex(/^\d{14}$/).optional(),
    inPerson: z.boolean().default(false),
    authenticateDocument: z.boolean().optional(),
    authenticateDocumentAndSelfie: z.boolean().optional(),
    authenticationMethod: z.enum(['email', 'password', 'sms', 'whats']).optional(),
    authenticationPhone: PhoneSchema.optional(),
    uploadAllowed: z.boolean().optional(),
    uploadInstructions: z.string().trim().min(1).max(2_000).optional(),
    whatsappNumber: PhoneSchema.optional(),
    groupUuid: z.uuid().optional(),
    passwordCode: z.string().min(4).max(128).optional(),
    videoSelfie: z.boolean().optional(),
    afterPosition: z.number().int().min(0).max(1_000).optional(),
    skipEmail: z.boolean().optional(),
  })
  .strict()
  .superRefine((signer, ctx) => {
    if (['sms', 'whats'].includes(signer.authenticationMethod ?? '') && signer.authenticationPhone === undefined) {
      ctx.addIssue({ code: 'custom', path: ['authenticationPhone'], message: 'Telefone é obrigatório para SMS/WhatsApp.' });
    }
    if (signer.authenticationMethod === 'password' && signer.passwordCode === undefined) {
      ctx.addIssue({ code: 'custom', path: ['passwordCode'], message: 'Código é obrigatório para senha.' });
    }
    if (signer.authenticateDocument === true && signer.authenticateDocumentAndSelfie === true) {
      ctx.addIssue({ code: 'custom', path: ['authenticateDocumentAndSelfie'], message: 'docauth e document+selfie são mutuamente exclusivos.' });
    }
    if (signer.inPerson && signer.requiresIcpBrasil) {
      ctx.addIssue({ code: 'custom', path: ['inPerson'], message: 'Assinatura presencial e ICP-Brasil são mutuamente exclusivas.' });
    }
    if (
      signer.inPerson
      && (
        signer.authenticateDocument === true
        || signer.authenticateDocumentAndSelfie === true
        || signer.videoSelfie === true
        || (signer.authenticationMethod !== undefined && signer.authenticationMethod !== 'password')
      )
    ) {
      ctx.addIssue({ code: 'custom', path: ['inPerson'], message: 'Assinatura presencial não pode combinar outros pontos de autenticação.' });
    }
    if (!signer.foreign && signer.foreignLanguage !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['foreignLanguage'], message: 'Idioma estrangeiro requer foreign=true.' });
    }
    if (
      !signer.requiresIcpBrasil
      && (signer.icpBrasilCertificateType !== undefined || signer.icpBrasilCpf !== undefined || signer.icpBrasilCnpj !== undefined)
    ) {
      ctx.addIssue({ code: 'custom', path: ['requiresIcpBrasil'], message: 'Dados ICP-Brasil requerem requiresIcpBrasil=true.' });
    }
  });

export const DocumentSignersAddInputSchema = z
  .object({
    documentUuid: z.uuid(),
    signers: z
      .array(SignerCreateSchema)
      .min(1)
      .max(25)
      .refine(
        (signers) => new Set(signers.map((signer) => signer.email)).size === signers.length,
        'Não repita e-mails na mesma chamada.',
      ),
  })
  .strict();

export const DocumentSignerUpdateInputSchema = z
  .object({
    documentUuid: z.uuid(),
    previousEmail: EmailSchema,
    newEmail: EmailSchema,
    keySigner: z.string().trim().min(1).max(256),
  })
  .strict()
  .refine((value) => value.previousEmail !== value.newEmail, {
    path: ['newEmail'],
    message: 'O novo e-mail deve ser diferente do atual.',
  });

export const DocumentSignerInfoAddInputSchema = z
  .object({
    documentUuid: z.uuid(),
    email: EmailSchema,
    keySigner: z.string().trim().min(1).max(256),
    displayName: z.string().trim().min(1).max(512).optional(),
    documentation: z.string().trim().min(1).max(64).optional(),
    birthday: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export const DocumentTagRemoveInputSchema = DocumentTagAddInputSchema;
export const DocumentObserverRemoveInputSchema = z
  .object({ documentUuid: z.uuid(), email: EmailSchema })
  .strict();

export const BatchCreatedOutputSchema = z
  .object({
    success: z.literal(true),
    batchId: z.string().min(1).max(512),
    totalDocuments: z.number().int().min(1).max(25),
    documentUuids: z.array(z.uuid()).min(1).max(25),
  })
  .strict();

const UploadAuditFields = {
  fileName: z.string().min(1).max(255),
  mimeType: UploadMimeTypeSchema,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  processing: z.literal(true),
};

export const DocumentUploadedOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    vaultUuid: z.uuid(),
    folderUuid: z.uuid().nullable(),
    ...UploadAuditFields,
  })
  .strict();

export const DocumentAttachmentUploadedOutputSchema = z
  .object({
    success: z.literal(true),
    mainDocumentUuid: z.uuid(),
    ...UploadAuditFields,
  })
  .strict();

export const DocumentDownloadOutputSchema = z
  .object({
    documentUuid: z.uuid(),
    name: z.string().min(1).max(512),
    url: z.url().max(4_096),
    type: z.enum(['pdf', 'pdfa', 'zip']),
    language: z.enum(['pt', 'en']),
    includesSignerDocuments: z.boolean(),
    includesVideoSelfieFrames: z.boolean(),
  })
  .strict();

export const DocumentCreatedFromTemplateOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    vaultUuid: z.uuid(),
    folderUuid: z.uuid().nullable(),
    templateCount: z.number().int().min(1).max(25),
    templateKind: z.enum(['html', 'word']),
  })
  .strict();

export const DocumentSignersAddedOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    requestedCount: z.number().int().min(1).max(25),
    signers: z.array(
      z.object({
        email: z.string().min(1).max(320),
        keySigner: z.string().min(1).max(256),
        status: z.string().min(1).max(128),
      }).strict(),
    ).min(1).max(25),
  })
  .strict();

export const DocumentSignerUpdatedOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    previousEmail: z.string().min(1).max(320),
    newEmail: z.string().min(1).max(320),
    keySigner: z.string().min(1).max(256),
  })
  .strict();

export const DocumentSignerInfoAddedOutputSchema = z
  .object({
    success: z.literal(true),
    documentUuid: z.uuid(),
    email: z.string().min(1).max(320),
    keySigner: z.string().min(1).max(256),
    displayName: z.string().max(512).nullable(),
    status: z.string().min(1).max(128),
  })
  .strict();

export const UserUnblockedOutputSchema = UserBlockedOutputSchema;
export const DocumentTagRemovedOutputSchema = DocumentTagAddedOutputSchema;
export const DocumentTagsRemovedAllOutputSchema = z
  .object({ success: z.literal(true), documentUuid: z.uuid(), removedCount: z.number().int().nonnegative() })
  .strict();
export const DocumentObserverRemovedOutputSchema = z
  .object({ success: z.literal(true), documentUuid: z.uuid(), email: z.string().min(1).max(320) })
  .strict();
export const DocumentObserversRemovedAllOutputSchema = DocumentTagsRemovedAllOutputSchema;
