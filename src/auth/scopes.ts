export const SCOPES = {
  vaultsRead: 'd4sign:vaults:read',
  vaultsWrite: 'd4sign:vaults:write',
  documentsRead: 'd4sign:documents:read',
  documentsWrite: 'd4sign:documents:write',
  documentsDownload: 'd4sign:documents:download',
  documentsSend: 'd4sign:documents:send',
  documentsCancel: 'd4sign:documents:cancel',
  signersRead: 'd4sign:signers:read',
  signersWrite: 'd4sign:signers:write',
  usersRead: 'd4sign:users:read',
  usersAdmin: 'd4sign:users:admin',
  tagsRead: 'd4sign:tags:read',
  tagsWrite: 'd4sign:tags:write',
  observersRead: 'd4sign:observers:read',
  observersWrite: 'd4sign:observers:write',
  webhooksRead: 'd4sign:webhooks:read',
  credentialsWrite: 'd4sign:credentials:write',
} as const;

export const D4SIGN_SCOPES = [...new Set(Object.values(SCOPES))];

export type D4SignScope = (typeof SCOPES)[keyof typeof SCOPES];
