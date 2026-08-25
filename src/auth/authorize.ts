import type { ServerContext } from '@modelcontextprotocol/server';

import type { AuthContext } from './auth-context.js';
import type { D4SignScope } from './scopes.js';
import type { McpTransport } from '../config/types.js';
import { AuthorizationError } from '../d4sign/errors.js';

export const LOCAL_STDIO_CONTEXT: AuthContext = {
  principalId: 'local-stdio',
  tenantId: 'local-single-tenant',
};

export type Authorizer = (ctx: ServerContext, requiredScope: D4SignScope) => AuthContext;

export function authContextFromServerContext(ctx: ServerContext): AuthContext | undefined {
  const authInfo = ctx.http?.authInfo;
  if (authInfo === undefined) return undefined;
  const extraPrincipalId = authInfo.extra?.principalId;
  const principalId = typeof extraPrincipalId === 'string' && extraPrincipalId.length > 0
    ? extraPrincipalId
    : authInfo.clientId;
  const extraTenantId = authInfo.extra?.tenantId;
  const tenantId = typeof extraTenantId === 'string' && extraTenantId.length > 0
    ? extraTenantId
    : authInfo.clientId;
  return { principalId, tenantId };
}

/**
 * Cria o autorizador vinculado ao transporte em uso.
 *
 * No transporte HTTP a ausência de contexto autenticado é falha fechada: nunca
 * cai no principal local de stdio, para que uma mudança de SDK ou de transporte
 * não possa transformar as 42 tools em operações sem verificação de scope.
 */
export function createAuthorizer(transport: McpTransport): Authorizer {
  return (ctx, requiredScope) => {
    if (transport === 'stdio') {
      // Processo local single-tenant: o dono do processo já é o principal.
      if (ctx.http === undefined) return LOCAL_STDIO_CONTEXT;
    }

    const authInfo = ctx.http?.authInfo;
    if (authInfo === undefined) {
      throw new AuthorizationError('Autenticação MCP ausente.');
    }
    if (!authInfo.scopes.includes(requiredScope)) {
      throw new AuthorizationError(`O principal não possui o scope necessário: ${requiredScope}.`);
    }
    const context = authContextFromServerContext(ctx);
    if (context === undefined) throw new AuthorizationError('Autenticação MCP ausente.');
    return context;
  };
}
