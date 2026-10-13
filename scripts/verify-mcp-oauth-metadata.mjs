#!/usr/bin/env node
// Verifica se um servidor MCP publica a descoberta OAuth que as ferramentas de IA
// exigem. Segue a revisão 2025-11-25 da especificação de autorização do MCP.
//
//   node scripts/verify-mcp-oauth-metadata.mjs https://mcp.d4sign.com.br
//
// Somente leitura: faz GETs de metadata e uma chamada /mcp sem token.
// Código de saída 1 quando algum requisito obrigatório falha.

const base = (process.argv[2] ?? '').replace(/\/$/u, '');
if (!/^https?:\/\//u.test(base)) {
  console.error('Uso: node scripts/verify-mcp-oauth-metadata.mjs <url-base-do-mcp>');
  process.exit(2);
}

let falhas = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const no = (m) => { falhas += 1; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };
const info = (m) => console.log(`  \x1b[33mℹ\x1b[0m ${m}`);
const titulo = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);
const verifica = (condicao, bom, ruim) => { if (condicao) ok(bom); else no(ruim); };
const avisa = (condicao, bom, aviso) => { if (condicao) ok(bom); else info(aviso); };
const local = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const seguro = (url) => new URL(url).protocol === 'https:' || local(url);

async function json(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { status: r.status };
    return { status: r.status, body: await r.json() };
  } catch (e) {
    return { status: 0, erro: e.message };
  }
}

titulo('1. Desafio de autenticação do recurso');
let metadataUrl = `${base}/.well-known/oauth-protected-resource`;
try {
  const r = await fetch(`${base}/mcp`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(15_000) });
  const desafio = r.headers.get('www-authenticate') ?? '';
  verifica(r.status === 401, '/mcp sem token devolve 401', `/mcp sem token devolveu ${r.status} (esperado 401)`);
  const m = /resource_metadata="([^"]+)"/u.exec(desafio);
  if (m) { ok('WWW-Authenticate informa resource_metadata'); metadataUrl = m[1]; }
  else no('WWW-Authenticate sem resource_metadata');
} catch (e) { no(`não alcançou ${base}/mcp: ${e.message}`); }

titulo('2. Metadata do recurso protegido (RFC 9728)');
const recurso = await json(metadataUrl);
if (!recurso.body) { no(`metadata do recurso indisponível (${recurso.status || recurso.erro})`); process.exit(1); }
ok(`resource: ${recurso.body.resource}`);
const servidores = recurso.body.authorization_servers;
if (!Array.isArray(servidores) || servidores.length === 0) { no('authorization_servers ausente'); process.exit(1); }
ok(`authorization_servers: ${servidores.join(', ')}`);
const escopos = recurso.body.scopes_supported ?? [];
avisa(escopos.length > 0, `${escopos.length} scopes anunciados`, 'nenhum scope anunciado: o host não saberá o que pedir');

titulo('3. Descoberta do authorization server');
const emissor = servidores[0].replace(/\/$/u, '');
const { origin, pathname } = new URL(emissor);
const caminho = pathname === '/' ? '' : pathname;
const candidatos = caminho === ''
  ? [`${origin}/.well-known/oauth-authorization-server`, `${origin}/.well-known/openid-configuration`]
  : [`${origin}/.well-known/oauth-authorization-server${caminho}`,
     `${origin}/.well-known/openid-configuration${caminho}`,
     `${origin}${caminho}/.well-known/openid-configuration`];
let meta;
let encontrado;
for (const url of candidatos) {
  const r = await json(url);
  info(`${r.status || 'erro'}  ${url}`);
  if (r.body && !meta) { meta = r.body; encontrado = url; }
}
if (!meta) { no('nenhum endpoint de descoberta respondeu'); process.exit(1); }
ok(`usada: ${encontrado}`);

titulo('4. Requisitos obrigatórios');
verifica(
  (meta.issuer ?? '').replace(/\/$/u, '') === emissor,
  'issuer idêntico ao identificador usado na descoberta (RFC 8414 §3.3)',
  `issuer diverge: metadata diz "${meta.issuer}", descoberta usou "${emissor}"`,
);
const pkce = meta.code_challenge_methods_supported;
verifica(
  Array.isArray(pkce) && pkce.includes('S256'),
  'declara PKCE S256 (a especificação manda o cliente recusar quem não declara)',
  'NÃO declara code_challenge_methods_supported com S256: clientes aderentes recusam este servidor',
);
verifica(meta.authorization_endpoint && seguro(meta.authorization_endpoint), 'authorization_endpoint presente e seguro', 'authorization_endpoint ausente ou inseguro');
verifica(meta.token_endpoint && seguro(meta.token_endpoint), 'token_endpoint presente e seguro', 'token_endpoint ausente ou inseguro');
if (meta.grant_types_supported) {
  verifica(meta.grant_types_supported.includes('authorization_code'), 'grant authorization_code declarado', 'grant authorization_code não declarado');
} else {
  no('grant_types_supported ausente');
}

titulo('5. Compatibilidade com ferramentas de IA (informativo)');
avisa(
  Boolean(meta.registration_endpoint),
  'registro dinâmico de cliente disponível: a ferramenta se cadastra sozinha',
  'sem registro dinâmico: cada ferramenta precisa de client ID configurado manualmente',
);
avisa((meta.token_endpoint_auth_methods_supported ?? []).includes('none'), 'aceita cliente público (método none)', 'método none não declarado');
const todos = [...(meta.scopes_supported ?? []), ...escopos];
avisa(
  todos.includes('offline_access'),
  'offline_access anunciado: a sessão pode ser renovada sem novo login',
  'offline_access não anunciado: algumas ferramentas podem pedir login de novo a cada expiração do token',
);

console.log(falhas === 0
  ? '\n\x1b[32mTudo certo: uma ferramenta aderente à especificação consegue iniciar o fluxo.\x1b[0m'
  : `\n\x1b[31m${falhas} requisito(s) obrigatório(s) falhando.\x1b[0m`);
process.exit(falhas === 0 ? 0 : 1);
