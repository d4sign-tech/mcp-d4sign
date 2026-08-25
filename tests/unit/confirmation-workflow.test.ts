import type { ServerContext } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';

import { createAuthorizer } from '../../src/auth/authorize.js';
import { AuthorizationError, ConfirmationError } from '../../src/d4sign/errors.js';
import { ConfirmationWorkflow, SENSITIVE_ACTIONS } from '../../src/server/confirmation-workflow.js';

const key = 'test-request-state-key-with-at-least-32-bytes';

function context(options: {
  state?: unknown;
  confirmation?: { action: 'accept' | 'decline' | 'cancel'; content?: { confirm: boolean } };
  principalId?: string;
  tenantId?: string;
} = {}): ServerContext {
  return {
    mcpReq: {
      method: 'tools/call',
      requestState: () => options.state,
      inputResponses: options.confirmation === undefined
        ? undefined
        : { confirmation: options.confirmation },
    },
    http: {
      authInfo: {
        token: 'test-token',
        clientId: options.principalId ?? 'principal-a',
        scopes: [],
        extra: { tenantId: options.tenantId ?? 'tenant-a' },
      },
    },
  } as unknown as ServerContext;
}

describe('ConfirmationWorkflow', () => {
  it('mantém exatamente as oito ações sensíveis do catálogo', () => {
    expect(SENSITIVE_ACTIONS).toEqual([
      'd4sign_document_send_for_signature',
      'd4sign_document_cancel',
      'd4sign_document_signature_link_resend',
      'd4sign_document_signer_remove',
      'd4sign_user_block',
      'd4sign_user_unblock',
      'd4sign_document_tags_remove_all',
      'd4sign_document_observers_remove_all',
    ]);
  });

  it('vincula a confirmação ao principal, aos argumentos e ao snapshot do alvo', async () => {
    const workflow = new ConfirmationWorkflow({ key, transport: 'http' });
    const initialContext = context();
    const required = await workflow.request(
      'd4sign_document_cancel',
      { documentUuid: '9f08bf18-bf4b-410f-9701-c286e5b1cad1' },
      { status: '3' },
      'Confirme o cancelamento.',
      initialContext,
    );
    expect(required.resultType).toBe('input_required');
    expect(required.requestState).toBeTypeOf('string');

    const decoded = await workflow.verifyRequestState(required.requestState ?? '', initialContext);
    const retryContext = context({
      state: decoded,
      confirmation: { action: 'accept', content: { confirm: true } },
    });
    const subjectDigest = await workflow.accept(
      'd4sign_document_cancel',
      { documentUuid: '9f08bf18-bf4b-410f-9701-c286e5b1cad1' },
      retryContext,
    );
    expect(() => workflow.assertSubjectUnchanged(subjectDigest, { status: '3' })).not.toThrow();
    expect(() => workflow.assertSubjectUnchanged(subjectDigest, { status: '4' })).toThrow(
      'O estado do alvo mudou',
    );

    await expect(
      workflow.verifyRequestState(required.requestState ?? '', context({ principalId: 'principal-b' })),
    ).rejects.toThrow('bind');
  });

  it('impede replay e rejeita estado adulterado', async () => {
    const workflow = new ConfirmationWorkflow({ key, transport: 'http' });
    const initialContext = context();
    const required = await workflow.request(
      'd4sign_user_block',
      { email: 'pessoa@example.com' },
      { email: 'pessoa@example.com', status: 'unblocked' },
      'Confirme o bloqueio.',
      initialContext,
    );
    const state = required.requestState ?? '';
    const stateParts = state.split('.');
    const mac = stateParts[2] ?? '';
    const tamperedState = [
      stateParts[0],
      stateParts[1],
      `${mac.startsWith('A') ? 'B' : 'A'}${mac.slice(1)}`,
    ].join('.');
    await expect(
      workflow.verifyRequestState(tamperedState, initialContext),
    ).rejects.toThrow();

    const decoded = await workflow.verifyRequestState(state, initialContext);
    const retryContext = context({
      state: decoded,
      confirmation: { action: 'accept', content: { confirm: true } },
    });
    await workflow.accept('d4sign_user_block', { email: 'pessoa@example.com' }, retryContext);
    await expect(
      workflow.accept('d4sign_user_block', { email: 'pessoa@example.com' }, retryContext),
    ).rejects.toThrow('já foi utilizada');
  });
});

describe('Autorização e binding fail-closed no transporte HTTP', () => {
  it('recusa tool sem contexto autenticado quando o transporte é HTTP', () => {
    const authorize = createAuthorizer('http');
    const ctx = { mcpReq: { method: 'tools/call', requestState: () => undefined } } as unknown as ServerContext;
    // Sem isto, uma mudança de SDK ou um transporte novo transformaria as 42
    // tools em operações sem verificação de scope, sob um principal fixo.
    expect(() => authorize(ctx, 'd4sign:documents:read')).toThrow(AuthorizationError);
  });

  it('mantém o principal local single-tenant no stdio', () => {
    const authorize = createAuthorizer('stdio');
    const ctx = { mcpReq: { method: 'tools/call', requestState: () => undefined } } as unknown as ServerContext;
    expect(authorize(ctx, 'd4sign:documents:read')).toEqual({
      principalId: 'local-stdio',
      tenantId: 'local-single-tenant',
    });
  });

  it('exige scope mesmo com contexto autenticado presente', () => {
    const authorize = createAuthorizer('http');
    const ctx = {
      mcpReq: { method: 'tools/call', requestState: () => undefined },
      http: { authInfo: { token: 't', clientId: 'c', scopes: ['d4sign:documents:read'], extra: {} } },
    } as unknown as ServerContext;
    expect(authorize(ctx, 'd4sign:documents:read')).toMatchObject({ principalId: 'c' });
    expect(() => authorize(ctx, 'd4sign:users:admin')).toThrow(AuthorizationError);
  });

  it('não emite confirmação MRTR sem identidade no transporte HTTP', async () => {
    const workflow = new ConfirmationWorkflow({ key, transport: 'http' });
    const ctx = { mcpReq: { method: 'tools/call', requestState: () => undefined } } as unknown as ServerContext;
    // Um binding constante permitiria apresentar a confirmação de um principal
    // no contexto de outro.
    await expect(workflow.request(
      'd4sign_document_cancel',
      { documentUuid: '9f08bf18-bf4b-410f-9701-c286e5b1cad1' },
      { status: '3' },
      'Confirme.',
      ctx,
    )).rejects.toBeInstanceOf(ConfirmationError);
  });
});
