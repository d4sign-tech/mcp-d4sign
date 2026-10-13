# Modelo de autenticação e credenciais

Há duas credenciais independentes e uma fronteira explícita entre elas:

```text
usuário/IA -- access token OIDC --> D4Sign MCP -- tokenAPI/cryptKey --> API D4Sign
```

O token OIDC autentica quem usa o MCP. Ele nunca é repassado à D4Sign. O `tokenAPI`/`cryptKey` autentica a conta na D4Sign e nunca é devolvido ao cliente, exposto em schema de tool ou solicitado na conversa.

## Desenvolvimento local

No stdio, o processo é single-tenant e lê `D4SIGN_TOKEN_API`/`D4SIGN_CRYPT_KEY` do ambiente. Stdio não usa OAuth.

No HTTP local, `MCP_AUTH_MODE=static` exige `MCP_BEARER_TOKEN` com ao menos 32 caracteres. Todas as chamadas usam a mesma conta D4Sign do `.env`. Esse perfil é recusado quando `NODE_ENV=production`.

## Produção na AWS

`MCP_AUTH_MODE=oidc` transforma o servidor em Resource Server OAuth:

1. o cliente inicia Authorization Code + PKCE no Cognito ou em outro IdP OIDC compatível;
2. solicita os scopes necessários;
3. o servidor valida assinatura por JWKS, issuer, expiração e o vínculo do token com este recurso;
4. `sub` identifica o principal; o issuer, ou `OIDC_TENANT_CLAIM`, particiona o tenant;
5. o campo `scope` autoriza cada tool.

### Como o token é vinculado a este recurso

Existem dois modos, e ao menos um é obrigatório — o boot falha se nenhum estiver configurado, porque sem vínculo qualquer token do mesmo issuer seria aceito.

| Modo | Quando usar | Configuração | Validação |
|---|---|---|---|
| `aud` (RFC 8707) | IdP que honra o parâmetro `resource` e emite `aud` no access token: Auth0, Okta, Keycloak, Entra ID | `OIDC_AUDIENCE=https://mcp.exemplo.com/mcp` | `aud` precisa ser exatamente o recurso |
| `client_id` | **Amazon Cognito** | `OIDC_ALLOWED_CLIENT_IDS=<app client id>` | `client_id` precisa estar na lista **e** `token_use` precisa ser `access` |

O access token de user pool do Amazon Cognito **não possui a claim `aud`** — ela existe apenas no ID token. A Lambda Pre Token Generation também não pode acrescentá-la, porque `aud` é claim reservada. E o Cognito não implementa RFC 8707: o parâmetro `resource` é ignorado e não produz `aud`. Por isso a stack em `infra/main.yaml` configura `OIDC_ALLOWED_CLIENT_IDS` com o app client provisionado e deixa `OIDC_AUDIENCE` vazio. Exigir `aud` com Cognito faria o servidor responder 401 a toda chamada autenticada.

No modo `client_id`, `token_use=access` deixa de ser opcional e passa a ser obrigatório: é o que garante que um ID token — que tem `aud` igual ao client ID — nunca seja aceito como credencial de recurso.

A stack cria um Cognito User Pool, domínio, cliente público e resource server. Como o Cognito representa scopes no formato `d4sign-mcp/d4sign:documents:read`, `OIDC_SCOPE_PREFIX=d4sign-mcp` remove o prefixo externo antes da autorização interna.

Com prefixo configurado, **somente scopes prefixados são aceitos**: um scope sem prefixo não passou pelo resource server deste recurso e é descartado, em vez de ser promovido a permissão interna. A claim `roles` é ignorada por completo — ela não é escopo OAuth deste recurso, e aceitá-la permitiria contornar a supressão feita na Lambda.

Conhecer um scope no cliente OAuth não equivale a concedê-lo ao usuário. Um trigger Cognito Pre Token Generation V2 aplica menor privilégio com base nos grupos e suprime do access token todo scope não autorizado:

| Grupo | Permissões emitidas |
|---|---|
| sem grupo | somente gerenciar as próprias credenciais D4Sign |
| `d4sign-readers` | credenciais próprias, leituras e downloads |
| `d4sign-operators` | todas as operações, exceto administração de usuários D4Sign |
| `d4sign-admins` | catálogo completo, inclusive `d4sign:users:admin` |

O User Pool usa o tier `ESSENTIALS`, necessário para customização de access token. A política é recalculada também quando um token é renovado; remover o usuário de um grupo reduz os scopes nos tokens novos. O servidor continua validando o scope exigido por cada tool, portanto a Lambda não substitui a autorização no MCP — ela limita o que o emissor pode conceder.

O servidor publica `/.well-known/oauth-protected-resource` e responde 401 com `resource_metadata`. Não há token passthrough: o access token de entrada nunca é enviado à D4Sign.

Clientes MCP genéricos também precisam conhecer o client ID e o callback cadastrados. Com IdP que implementa RFC 8707, devem enviar `resource` com a URL exata do MCP; com Cognito, o parâmetro é ignorado e o vínculo é o próprio client ID. O Cognito não oferece Dynamic Client Registration irrestrito. Se o host não aceitar um cliente previamente registrado, é necessário um Authorization Server/proxy de onboarding à frente do Cognito.

## Descoberta para ferramentas de IA

Ferramentas como ChatGPT e Claude não recebem a configuração do login: elas a **descobrem**, seguindo a especificação de autorização do MCP.

1. Chamam `/mcp` sem token e recebem `401` com `WWW-Authenticate: ... resource_metadata="..."`.
2. Leem `/.well-known/oauth-protected-resource` e descobrem o authorization server.
3. Leem a metadata do authorization server e **verificam que ele declara PKCE** (`code_challenge_methods_supported`). A revisão 2025-11-25 manda o cliente recusar quem não declara.

O Amazon Cognito executa PKCE, mas não o declara, e também responde `400` ao caminho do RFC 8414. Por isso, com `OIDC_METADATA_FACADE=true`, este servidor:

- aponta `authorization_servers` para a **própria origem pública**;
- publica `/.well-known/oauth-authorization-server` com PKCE `S256`, `authorization_code` e `refresh_token`, copiando do Cognito os endpoints de login e de token;
- anuncia apenas os scopes que uma ferramenta de IA pode obter. `d4sign:users:admin` e `d4sign:credentials:write` ficam de fora, tanto por menor privilégio quanto porque anunciar um scope que o client nega faz o host receber `invalid_scope`.

Os tokens continuam sendo emitidos e assinados pelo Cognito, e o servidor continua validando issuer, client ID e scopes como antes. A camada só **descreve** o provedor.

Limites conhecidos: não há registro dinâmico de cliente, então cada ferramenta usa um client ID configurado à mão; e o Cognito não aceita `offline_access`, então a duração da sessão depende de a ferramenta usar o refresh token que o Cognito já emite.

Para conferir qualquer servidor MCP contra esses requisitos:

```bash
node scripts/verify-mcp-oauth-metadata.mjs https://mcp.d4sign.com.br
```

## Onboarding das credenciais D4Sign

O cadastro ocorre fora do chat:

```http
PUT /credentials/d4sign
Authorization: Bearer <access-token-oidc>
Content-Type: application/json

{
  "tokenApi": "...",
  "cryptKey": "...",
  "environment": "production",
  "requestsPerHour": 1000
}
```

O endpoint exige `d4sign:credentials:write`, responde `204` e não ecoa segredos. Um secret JSON é gravado no AWS Secrets Manager com KMS e nome derivado de SHA-256 do principal — ou tenant quando `D4SIGN_CREDENTIAL_SCOPE=tenant`. Rotação repete o `PUT`; revogação usa `DELETE` com janela de recuperação de sete dias. Ambas emitem evento de auditoria.

Rotação e revogação **alcançam todas as tasks imediatamente**: cada operação incrementa uma geração compartilhada no Redis, e o cache local de credenciais (TTL de 30 s, `D4SIGN_CREDENTIAL_CACHE_TTL_MS`) só é considerado válido enquanto refletir a geração corrente. O incremento acontece antes e depois da escrita, para que um carregamento em voo não recacheie a credencial antiga.

O container acessa Secrets Manager e S3 pelas credenciais temporárias do ECS task role. ElastiCache usa TLS e uma senha RBAC injetada pelo ECS a partir do Secrets Manager. Nenhuma chave AWS está na imagem ou no repositório.

## Scopes

Os scopes internos são os valores de `src/auth/scopes.ts`. Cognito acrescenta o prefixo do resource server ao emitir o token. Leituras, escritas, download, envio, cancelamento, administração e gerenciamento das próprias credenciais permanecem separados.

## Dados que nunca entram na conversa ou nos logs

- `tokenAPI` e `cryptKey`;
- bearer local ou JWT OIDC;
- senha do ElastiCache e chave MRTR;
- conteúdo/base64 de documentos;
- identificadores pessoais usados para indexar segredos.

O endpoint de onboarding é uma API de suporte. Em produto, uma tela autenticada deve chamá-lo por HTTPS, informar sucesso/rotação/revogação e nunca armazenar os valores no navegador depois do envio.
