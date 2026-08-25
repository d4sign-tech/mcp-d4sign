import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, InMemoryTransport } from '@modelcontextprotocol/server';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { D4SIGN_SCOPES } from '../../src/auth/scopes.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { InMemoryUploadStore } from '../../src/infra/upload-store.js';
import { buildServer } from '../../src/server/build-server.js';
import { ConfirmationWorkflow } from '../../src/server/confirmation-workflow.js';
import { D4SignReadService } from '../../src/services/d4sign-read-service.js';
import { D4SignFileService } from '../../src/services/d4sign-file-service.js';
import { D4SignWriteService } from '../../src/services/d4sign-write-service.js';

const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const logger = pino({ enabled: false });

function dependencies(fetchImpl: typeof fetch) {
  const credentialProvider = new MockCredentialProvider({
    tokenApi: 'token-de-teste',
    environment: 'sandbox',
  });
  const cache = new InMemoryPrivateCache();
  const quotaManager = new InMemoryQuotaManager(10);
  const uploadStore = new InMemoryUploadStore(600_000);
  const readService = new D4SignReadService({
    credentialProvider,
    cache,
    quotaManager,
    logger,
    timeoutMs: 1_000,
    maxResponseBytes: 50_000,
    fetchImpl,
  });
  const writeService = new D4SignWriteService({
    credentialProvider,
    cache,
    quotaManager,
    logger,
    timeoutMs: 1_000,
    maxResponseBytes: 50_000,
    fetchImpl,
  });
  const fileService = new D4SignFileService({
    credentialProvider,
    cache,
    quotaManager,
    uploadStore,
    logger,
    timeoutMs: 1_000,
    maxResponseBytes: 50_000,
    maxUploadBytes: 10_000_000,
    fetchImpl,
  });
  return {
    readService,
    writeService,
    fileService,
    uploadStore,
    confirmationWorkflow: new ConfirmationWorkflow({
      key: 'test-request-state-key-with-at-least-32-bytes',
      transport: 'http',
    }),
    logger,
    transport: 'http' as const,
  };
}

function documentResponse(): Response {
  return new Response(JSON.stringify({
    uuidDoc: documentUuid,
    nameDoc: 'contrato.pdf',
    statusId: '3',
    statusName: 'Aguardando Assinaturas',
  }), { status: 200 });
}

describe('confirmação sensível MCP ponta a ponta', () => {
  it('só cancela depois do aceite humano e da releitura do documento', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(JSON.stringify({ message: 'Message sent' }), { status: 200 })
          : documentResponse(),
      ));
    const deps = dependencies(fetchMock);
    const handler = createMcpHandler(() => buildServer(deps), {
      legacy: 'reject',
      responseMode: 'auto',
    });
    const localFetch: typeof fetch = async (input, init) =>
      handler.fetch(new Request(input, init), {
        authInfo: {
          token: 'mcp-test-token',
          clientId: 'confirmation-test',
          scopes: D4SIGN_SCOPES,
          extra: { tenantId: 'test-tenant' },
        },
      });
    const clientTransport = new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
      fetch: localFetch,
    });
    const client = new Client(
      { name: 'confirmation-test', version: '1.0.0' },
      {
        capabilities: { elicitation: {} },
        versionNegotiation: { mode: { pin: '2026-07-28' } },
      },
    );
    const prompts: string[] = [];
    client.setRequestHandler('elicitation/create', (request) => {
      prompts.push(request.params.message);
      return { action: 'accept', content: { confirm: true } };
    });
    await client.connect(clientTransport);

    try {
      expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
      const result = await client.callTool({
        name: 'd4sign_document_cancel',
        arguments: { documentUuid, comment: 'Contrato substituído' },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ success: true, documentUuid });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('contrato.pdf');
      expect(prompts[0]).toContain('Consequência irreversível');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'GET', 'POST']);
    } finally {
      await client.close();
    }
  });

  it('não executa a mutação quando a confirmação é recusada', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(documentResponse()));
    const server = buildServer({
      ...dependencies(fetchMock),
      transport: 'stdio',
      confirmationWorkflow: new ConfirmationWorkflow({
        key: 'test-request-state-key-with-at-least-32-bytes',
        transport: 'stdio',
      }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client(
      { name: 'decline-test', version: '1.0.0' },
      { capabilities: { elicitation: {} } },
    );
    client.setRequestHandler('elicitation/create', () => ({ action: 'decline' }));
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'd4sign_document_cancel',
        arguments: { documentUuid },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('não foi confirmada');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('remove todas as tags somente após confirmar e reler o mesmo snapshot', async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = input instanceof Request ? new URL(input.url) : new URL(input);
      if (url.pathname === `/api/v1/tags/${documentUuid}`) {
        return Promise.resolve(new Response(JSON.stringify({
          uuid_arquivo: documentUuid,
          TAGs: 'juridico, urgente',
        }), { status: 200 }));
      }
      if (url.pathname.endsWith('/erase') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ message: 'All TAGs removed successfully' }), {
          status: 200,
        }));
      }
      return Promise.resolve(documentResponse());
    });
    const deps = dependencies(fetchMock);
    const handler = createMcpHandler(() => buildServer(deps), {
      legacy: 'reject',
      responseMode: 'auto',
    });
    const localFetch: typeof fetch = async (input, init) =>
      handler.fetch(new Request(input, init), {
        authInfo: {
          token: 'mcp-test-token',
          clientId: 'remove-tags-test',
          scopes: D4SIGN_SCOPES,
          extra: { tenantId: 'test-tenant' },
        },
      });
    const client = new Client(
      { name: 'remove-tags-test', version: '1.0.0' },
      {
        capabilities: { elicitation: {} },
        versionNegotiation: { mode: { pin: '2026-07-28' } },
      },
    );
    const prompts: string[] = [];
    client.setRequestHandler('elicitation/create', (request) => {
      prompts.push(request.params.message);
      return { action: 'accept', content: { confirm: true } };
    });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
      fetch: localFetch,
    }));

    try {
      const result = await client.callTool({
        name: 'd4sign_document_tags_remove_all',
        arguments: { documentUuid },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ success: true, documentUuid, removedCount: 2 });
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain('juridico');
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const mutation = fetchMock.mock.calls.find(([input]) => {
        const url = input instanceof Request ? new URL(input.url) : new URL(input);
        return url.pathname.endsWith('/erase');
      });
      expect(mutation).toBeDefined();
    } finally {
      await client.close();
    }
  });
});
