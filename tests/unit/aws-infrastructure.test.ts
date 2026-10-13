import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { D4SIGN_SCOPES } from '../../src/auth/scopes.js';

interface CognitoEvent {
  request: {
    scopes: string[];
    groupConfiguration: { groupsToOverride: string[] };
  };
  response: Record<string, unknown>;
}

type CognitoHandler = (event: CognitoEvent) => Promise<CognitoEvent>;

const template = readFileSync(new URL('../../infra/main.yaml', import.meta.url), 'utf8');

function loadScopePolicy(): CognitoHandler {
  const startMarker = '        ZipFile: |\n';
  const endMarker = '\n  CognitoScopePolicyInvokePermission:';
  const start = template.indexOf(startMarker);
  const end = template.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('Lambda de política de scopes não encontrada no CloudFormation.');

  const source = template
    .slice(start + startMarker.length, end)
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
  const sandbox: { exports: { handler?: CognitoHandler } } = { exports: {} };
  vm.runInNewContext(source, sandbox, { filename: 'cognito-scope-policy.js' });
  if (sandbox.exports.handler === undefined) throw new Error('Handler da política de scopes não foi exportado.');
  return sandbox.exports.handler;
}

async function issuedScopes(groups: string[]): Promise<string[]> {
  const requested = ['openid', 'email', ...D4SIGN_SCOPES.map((scope) => `d4sign-mcp/${scope}`)];
  const result = await loadScopePolicy()({
    request: { scopes: requested, groupConfiguration: { groupsToOverride: groups } },
    response: {},
  });
  const details = result.response as {
    claimsAndScopeOverrideDetails: { accessTokenGeneration: { scopesToSuppress: string[] } };
  };
  const suppressed = new Set(details.claimsAndScopeOverrideDetails.accessTokenGeneration.scopesToSuppress);
  return requested.filter((scope) => !suppressed.has(scope));
}

describe('infraestrutura AWS', () => {
  it('mantém o catálogo de scopes sincronizado com o resource server Cognito', () => {
    for (const scope of D4SIGN_SCOPES) {
      expect(template).toContain(`ScopeName: '${scope}'`);
      expect(template).toContain(`- d4sign-mcp/${scope}`);
    }
  });

  it('limita a ACL Redis ao prefixo e aos comandos realmente usados', () => {
    const accessStrings = [...template.matchAll(/AccessString: '([^']+)'/gu)].map((match) => match[1] ?? '');
    // O usuário `default` do ElastiCache precisa estar desligado, senão haveria
    // acesso sem RBAC ao keyspace inteiro.
    expect(accessStrings).toContain('off ~* -@all');
    const accessString = accessStrings.find((entry) => entry.startsWith('on ')) ?? '';
    // Asserção por conteúdo, não por igualdade literal: acrescentar um comando
    // legítimo não deve quebrar o teste, mas liberar tudo deve.
    expect(accessString).toContain('~d4sign-mcp:*');
    expect(accessString).toContain('-@all');
    for (const command of ['+get', '+set', '+del', '+scan', '+eval', '+incr', '+incrby', '+pexpire', '+pttl']) {
      expect(accessString).toContain(command);
    }
    expect(accessString).not.toContain('+@all');
    expect(accessString).not.toContain('~*');
    expect(accessString).not.toContain('+flushall');
    expect(accessString).not.toContain('+config');
  });

  it('não usa claim aud para vincular o token, porque o Cognito não a emite', () => {
    // O access token de user pool do Cognito não possui `aud`, e a Lambda Pre
    // Token Generation não pode adicioná-la. Exigir `aud` faria a stack
    // responder 401 a toda chamada autenticada.
    expect(template).toContain('Name: OIDC_ALLOWED_CLIENT_IDS');
    expect(template).not.toContain('Name: OIDC_AUDIENCE');
  });

  it('publica a metadata de authorization server que o Cognito não declara', () => {
    expect(template).toMatch(/Name: OIDC_METADATA_FACADE, Value: 'true'/u);
  });

  it('impede eviction silenciosa do estado de segurança no ElastiCache', () => {
    // Chaves de anti-replay MRTR e de cota têm TTL; com volatile-lru, pressão de
    // memória poderia liberar replay de uma operação sensível.
    expect(template).toContain('maxmemory-policy: noeviction');
    expect(template).toContain('CacheParameterGroupName: !Ref RedisParameterGroup');
    expect(template).toContain('MetricName: Evictions');
  });

  it('permite apagar a versão do objeto temporário, não apenas criar delete marker', () => {
    expect(template).toContain('s3:DeleteObjectVersion');
  });

  it('exige MFA e restringe os fluxos de autenticação do Cognito', () => {
    expect(template).toContain("MfaConfiguration: 'ON'");
    expect(template).toContain('ALLOW_USER_SRP_AUTH');
    expect(template).not.toContain('ALLOW_USER_PASSWORD_AUTH');
    expect(template).not.toContain('ALLOW_ADMIN_USER_PASSWORD_AUTH');
  });

  it('protege a role do GuardDuty contra confused deputy', () => {
    expect(template).toContain('aws:SourceAccount: !Ref AWS::AccountId');
    expect(template).toContain('aws:SourceArn: !Sub arn:${AWS::Partition}:guardduty');
  });

  it('entrega os alarmes a um destino e cobre estado, latência e antimalware', () => {
    expect(template).toContain('AlarmActions: [!Ref AlarmTopic]');
    for (const metric of [
      'HTTPCode_Target_5XX_Count',
      'HTTPCode_Target_4XX_Count',
      'TargetResponseTime',
      'DatabaseMemoryUsagePercentage',
      'FailedScanCount',
      'InfectedScanCount',
    ]) {
      expect(template).toContain(`MetricName: ${metric}`);
    }
  });

  it('associa WAF ao ALB e habilita access logs', () => {
    expect(template).toContain('Type: AWS::WAFv2::WebACLAssociation');
    expect(template).toContain('RateBasedStatement');
    expect(template).toContain('access_logs.s3.enabled');
  });

  it('restringe o egress das tasks em vez de herdar liberação total', () => {
    expect(template).toContain('SecurityGroupEgress');
    expect(template).toContain('Description: Amazon ElastiCache');
  });

  it('fixa a imagem base por digest e não executa scripts de dependência', () => {
    const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
    expect(dockerfile).toMatch(/node:24-alpine@sha256:[0-9a-f]{64}/u);
    expect(dockerfile).toContain('npm ci --ignore-scripts');
  });

  it('dá ao container prazo de parada maior que a drenagem da aplicação', () => {
    const stopTimeout = Number(/StopTimeout: (\d+)/u.exec(template)?.[1] ?? '0');
    const graceMs = Number(/MCP_SHUTDOWN_GRACE_MS, Value: '(\d+)'/u.exec(template)?.[1] ?? '0');
    expect(graceMs).toBeGreaterThan(0);
    expect(stopTimeout * 1_000).toBeGreaterThan(graceMs);
  });

  it('aplica menor privilégio aos grupos do Cognito', async () => {
    const ownCredentials = 'd4sign-mcp/d4sign:credentials:write';
    await expect(issuedScopes([])).resolves.toEqual(['openid', 'email', ownCredentials]);

    const reader = await issuedScopes(['d4sign-readers']);
    expect(reader).toContain(ownCredentials);
    expect(reader).toContain('d4sign-mcp/d4sign:documents:read');
    expect(reader).toContain('d4sign-mcp/d4sign:documents:download');
    expect(reader).not.toContain('d4sign-mcp/d4sign:documents:write');

    const operator = await issuedScopes(['d4sign-operators']);
    expect(operator).toContain('d4sign-mcp/d4sign:documents:send');
    expect(operator).not.toContain('d4sign-mcp/d4sign:users:admin');

    await expect(issuedScopes(['d4sign-admins'])).resolves.toEqual([
      'openid',
      'email',
      ...D4SIGN_SCOPES.map((scope) => `d4sign-mcp/${scope}`),
    ]);
  });
});
