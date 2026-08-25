import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { MockCredentialProvider } from '../../src/auth/credential-provider.js';
import { InMemoryPrivateCache } from '../../src/infra/cache.js';
import { InMemoryQuotaManager } from '../../src/infra/quota-manager.js';
import { D4SignReadService } from '../../src/services/d4sign-read-service.js';

const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';
const groupUuid = 'aea20243-475a-43fc-8ba5-c02f6eec76fc';
const accountUuid = '509d5808-0797-4d26-b21a-f76e9e07cc49';
const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';
const email = 'pessoa@example.com';
const logger = pino({ enabled: false });
const auth = { principalId: 'test-user', tenantId: 'test-tenant' };

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

describe('D4SignReadService — Sprint 3', () => {
  it('chama os cinco contratos com método, path e body corretos', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      let response: unknown;
      if (url.pathname === `/api/v1/groups/${vaultUuid}`) {
        response = [{ uuid_grupo: groupUuid, nome: 'Jurídico' }];
      } else if (url.pathname === `/api/v1/groups/${vaultUuid}/groupdetails/${groupUuid}`) {
        response = {
          name_group: 'Jurídico',
          group_details: [
            {
              uuid_conta: accountUuid,
              uuid_grupo: groupUuid,
              email: 'juridico@example.com',
              sequencia: '1',
            },
          ],
        };
      } else if (url.pathname === '/api/v1/users/check') {
        response = { user: email, status: 'unblocked' };
      } else if (url.pathname === `/api/v1/watcher/${documentUuid}`) {
        response = {
          uuid_arquivo: documentUuid,
          watchers: [{ email: 'observador@example.com', perfil: '0' }],
        };
      } else if (url.pathname === `/api/v1/documents/${documentUuid}/webhooks`) {
        response = { uuid: documentUuid, webhook_url: 'https://example.com/d4sign/events' };
      } else {
        return Promise.resolve(new Response('{}', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
    });
    const service = new D4SignReadService({
      credentialProvider: new MockCredentialProvider({ tokenApi: 'token-de-teste', environment: 'sandbox' }),
      cache: new InMemoryPrivateCache(),
      quotaManager: new InMemoryQuotaManager(10),
      logger,
      timeoutMs: 1_000,
      maxResponseBytes: 50_000,
      fetchImpl: fetchMock,
    });

    await expect(service.listSignatureGroups(auth, vaultUuid)).resolves.toEqual([
      { uuid: groupUuid, name: 'Jurídico' },
    ]);
    await expect(service.getSignatureGroup(auth, { vaultUuid, groupUuid })).resolves.toMatchObject({
      vaultUuid,
      groupUuid,
      members: [{ accountUuid, email: 'juridico@example.com' }],
    });
    await expect(service.verifyUser(auth, email)).resolves.toEqual({ email, status: 'unblocked' });
    await expect(service.listDocumentObservers(auth, documentUuid)).resolves.toMatchObject({
      documentUuid,
      observers: [{ email: 'observador@example.com', profile: '0' }],
    });
    await expect(service.listDocumentWebhooks(auth, documentUuid)).resolves.toEqual({
      documentUuid,
      webhooks: [{ url: 'https://example.com/d4sign/events' }],
    });

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      body: init?.body,
      method: init?.method,
      url: requestUrl(input),
    }));
    expect(calls).toHaveLength(5);
    expect(calls.map(({ method }) => method)).toEqual(['GET', 'GET', 'POST', 'GET', 'GET']);
    expect(calls[2]?.body).toBe(JSON.stringify({ email_user: email }));
    expect(calls.every(({ url }) => url.searchParams.get('tokenAPI') === 'token-de-teste')).toBe(true);
    expect(calls[2]?.url.searchParams.has('email_user')).toBe(false);
  });
});
