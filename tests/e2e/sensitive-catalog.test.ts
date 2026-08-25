import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { D4SIGN_SCOPES } from '../../src/auth/scopes.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryClaimStore } from '../../src/infra/claim-store.js';
import { InMemoryGenerationStore } from '../../src/infra/generation-store.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { InMemoryReplayStore } from '../../src/infra/replay-store.js';
import { InMemoryUploadStore } from '../../src/infra/upload-store.js';
import { buildServer } from '../../src/server/build-server.js';
import { ConfirmationWorkflow, SENSITIVE_ACTIONS } from '../../src/server/confirmation-workflow.js';
import { D4SignFileService } from '../../src/services/d4sign-file-service.js';
import { D4SignReadService } from '../../src/services/d4sign-read-service.js';
import { D4SignWriteService } from '../../src/services/d4sign-write-service.js';

const logger = pino({ enabled: false });
const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const keySigner = 'chave-do-signatario-1';
const signerEmail = 'signatario@example.com';
const blockedEmail = 'bloqueado@example.com';

interface Fixture {
  tool: string;
  args: Record<string, unknown>;
  /** Fase do documento aceita pela operação. */
  statusId: string;
  /** Trecho que precisa aparecer no formulário de confirmação. */
  expectedPrompt: string;
  mutationPath: string;
}

/** Uma fixture por tool MRTR: as oito precisam de cobertura ponta a ponta. */
const FIXTURES: Fixture[] = [
  {
    tool: 'd4sign_document_send_for_signature',
    args: { documentUuid, notifySigners: true, followSigningOrder: false },
    statusId: '2',
    expectedPrompt: 'enviar para assinatura',
    mutationPath: '/sendtosigner',
  },
  {
    tool: 'd4sign_document_cancel',
    args: { documentUuid },
    statusId: '3',
    expectedPrompt: 'Consequência irreversível',
    mutationPath: '/cancel',
  },
  {
    tool: 'd4sign_document_signature_link_resend',
    args: { documentUuid, email: signerEmail, keySigner },
    statusId: '3',
    expectedPrompt: 'reenviar link',
    mutationPath: '/resend',
  },
  {
    tool: 'd4sign_document_signer_remove',
    args: { documentUuid, email: signerEmail, keySigner },
    statusId: '3',
    expectedPrompt: 'remover signatário',
    mutationPath: '/removeemaillist',
  },
  {
    tool: 'd4sign_user_block',
    args: { email: signerEmail },
    statusId: '3',
    expectedPrompt: 'bloquear o usuário',
    mutationPath: '/users/block',
  },
  {
    tool: 'd4sign_user_unblock',
    args: { email: blockedEmail },
    statusId: '3',
    expectedPrompt: 'desbloquear o usuário',
    mutationPath: '/users/unblock',
  },
  {
    tool: 'd4sign_document_tags_remove_all',
    args: { documentUuid },
    statusId: '3',
    expectedPrompt: 'Serão removidas',
    mutationPath: '/erase',
  },
  {
    tool: 'd4sign_document_observers_remove_all',
    args: { documentUuid },
    statusId: '3',
    expectedPrompt: 'Serão removidos',
    mutationPath: '/erase',
  },
];

function upstream(statusId: string): typeof fetch {
  return (input, init) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input);
    const path = url.pathname.replace('/api/v1', '');
    const json = (body: unknown): Response => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })) as never;

    if (path === `/documents/${documentUuid}` && init?.method !== 'POST') {
      return json({ uuidDoc: documentUuid, nameDoc: 'contrato.pdf', statusId, statusName: 'Fase' }) as never;
    }
    if (path === `/documents/${documentUuid}/list`) {
      return json({
        uuidDoc: documentUuid,
        list: [{ key_signer: keySigner, user_name: 'Pessoa', email: signerEmail, signed: '0' }],
      }) as never;
    }
    if (path === `/tags/${documentUuid}`) {
      return json({ uuid_arquivo: documentUuid, TAGs: 'juridico, urgente' }) as never;
    }
    if (path === `/watcher/${documentUuid}`) {
      return json({ uuid_arquivo: documentUuid, watchers: [{ email: 'observador@example.com', perfil: '1' }] }) as never;
    }
    if (path === '/users/check') {
      const body = typeof init?.body === 'string' ? init.body : '';
      const bloqueado = body.includes(blockedEmail);
      return json({ user: bloqueado ? blockedEmail : signerEmail, status: bloqueado ? 'blocked' : 'active' }) as never;
    }
    return json({ message: 'ok' }) as never;
  };
}

function server(fetchImpl: typeof fetch) {
  const credentialProvider = new MockCredentialProvider({ tokenApi: 'token', environment: 'sandbox' });
  const generations = new InMemoryGenerationStore();
  const cache = new InMemoryPrivateCache(500, generations);
  const quotaManager = new InMemoryQuotaManager(200);
  const shared = { credentialProvider, cache, quotaManager, logger, timeoutMs: 1_000, maxResponseBytes: 50_000, fetchImpl };
  return {
    transport: 'http' as const,
    readService: new D4SignReadService(shared),
    writeService: new D4SignWriteService(shared),
    fileService: new D4SignFileService({
      ...shared,
      uploadStore: new InMemoryUploadStore(600_000),
      claimStore: new InMemoryClaimStore(),
      maxUploadBytes: 1_000_000,
    }),
    uploadStore: new InMemoryUploadStore(600_000),
    confirmationWorkflow: new ConfirmationWorkflow({
      key: 'chave-de-teste-mrtr-com-mais-de-32-bytes',
      transport: 'http',
      replayStore: new InMemoryReplayStore(),
    }),
    logger,
  };
}

async function connect(fetchImpl: typeof fetch, onElicit: () => { action: 'accept' | 'decline'; content?: { confirm: boolean } }) {
  const handler = createMcpHandler(() => buildServer(server(fetchImpl)), { legacy: 'reject', responseMode: 'auto' });
  const prompts: string[] = [];
  const localFetch: typeof fetch = async (input, init) => handler.fetch(new Request(input, init), {
    authInfo: {
      token: 'token',
      clientId: 'cliente',
      scopes: D4SIGN_SCOPES,
      expiresAt: Math.floor(Date.now() / 1_000) + 300,
      extra: { principalId: 'principal-a', tenantId: 'tenant-a' },
    },
  });
  const client = new Client(
    { name: 'mrtr-test', version: '1.0.0' },
    { capabilities: { elicitation: {} }, versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  client.setRequestHandler('elicitation/create', (request) => {
    prompts.push(request.params.message);
    return onElicit();
  });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), { fetch: localFetch }));
  return { client, prompts };
}

describe('Catálogo MRTR ponta a ponta', () => {
  it('cobre exatamente as oito ações sensíveis declaradas', () => {
    expect(FIXTURES.map((fixture) => fixture.tool).sort()).toEqual([...SENSITIVE_ACTIONS].sort());
  });

  it.each(FIXTURES)('$tool apresenta o alvo e só muta após aceite', async (fixture) => {
    const fetchMock = vi.fn(upstream(fixture.statusId));
    const { client, prompts } = await connect(fetchMock, () => ({
      action: 'accept',
      content: { confirm: true },
    }));

    try {
      const result = await client.callTool({ name: fixture.tool, arguments: fixture.args });
      expect(result.isError).not.toBe(true);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain(fixture.expectedPrompt);

      const mutations = fetchMock.mock.calls.filter(([input, init]) => {
        const url = input instanceof Request ? new URL(input.url) : new URL(input);
        return init?.method === 'POST' && url.pathname.includes(fixture.mutationPath);
      });
      expect(mutations).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it.each(FIXTURES)('$tool não muta nada quando a confirmação é recusada', async (fixture) => {
    const fetchMock = vi.fn(upstream(fixture.statusId));
    const { client } = await connect(fetchMock, () => ({ action: 'decline' }));

    try {
      const result = await client.callTool({ name: fixture.tool, arguments: fixture.args });
      expect(result.isError).toBe(true);
      const mutations = fetchMock.mock.calls.filter(([input, init]) => {
        const url = input instanceof Request ? new URL(input.url) : new URL(input);
        return init?.method === 'POST' && url.pathname.includes(fixture.mutationPath);
      });
      expect(mutations).toHaveLength(0);
    } finally {
      await client.close();
    }
  });
});
