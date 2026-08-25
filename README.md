# D4Sign MCP

Servidor MCP TypeScript para a API D4Sign. O catálogo funcional definido em `D4Sign_MCP_SKILL.md` está completo: 42 tools de cofres, documentos, arquivos, templates, signatários, usuários, tags, observadores e webhooks.

O projeto suporta MCP `2026-07-28` por Streamable HTTP e stdio. Há dois perfis explícitos: desenvolvimento local single-tenant por `.env` e produção multi-instância na AWS com ECS Fargate, Cognito/OIDC, Secrets Manager, ElastiCache Redis e S3.

## Catálogo

| Domínio | Tools |
|---|---|
| Cofres e lotes | `d4sign_vaults_list`, `d4sign_vault_documents_list`, `d4sign_vault_folders_list`, `d4sign_vault_folder_create`, `d4sign_vault_folder_rename`, `d4sign_batch_create` |
| Documentos e arquivos | `d4sign_documents_list`, `d4sign_document_get`, `d4sign_documents_list_by_phase`, `d4sign_document_upload`, `d4sign_document_attachment_upload`, `d4sign_document_binary_upload`, `d4sign_document_attachment_binary_upload`, `d4sign_document_send_for_signature`, `d4sign_document_cancel`, `d4sign_document_download`, `d4sign_document_signature_link_resend` |
| Templates e anexos | `d4sign_templates_list`, `d4sign_document_create_from_html_template`, `d4sign_document_create_from_word_template`, `d4sign_document_attachments_list` |
| Signatários | `d4sign_document_signers_list`, `d4sign_signature_groups_list`, `d4sign_signature_group_get`, `d4sign_document_signers_add`, `d4sign_document_signer_update`, `d4sign_document_signer_remove`, `d4sign_document_signer_info_add` |
| Usuários | `d4sign_user_verify`, `d4sign_user_block`, `d4sign_user_unblock` |
| Tags | `d4sign_document_tags_list`, `d4sign_document_tags_add`, `d4sign_document_tags_remove`, `d4sign_document_tags_remove_all`, `d4sign_document_mark_urgent`, `d4sign_document_unmark_urgent` |
| Observadores e webhooks | `d4sign_document_observers_list`, `d4sign_document_observer_add`, `d4sign_document_observer_remove`, `d4sign_document_observers_remove_all`, `d4sign_document_webhooks_list` |

O typecheck falha se o catálogo mudar de tamanho sem atualizar `EXPECTED_TOOL_COUNT`, e o teste E2E falha se o servidor anunciar número diferente de 42, mudar a ordem sem atualização explícita, classificar mal `readOnlyHint`/`destructiveHint` ou expuser `tokenAPI`/`cryptKey` nos schemas.

## Requisitos e configuração

- Node.js 20 ou superior;
- conta D4Sign com API habilitada;
- `tokenAPI` e, quando habilitada na conta, `cryptKey`;
- credenciais e fixtures isoladas para homologação real no sandbox.

Copie `.env.example` para `.env`. O processo não procura esse arquivo implicitamente; use `node --env-file=.env`, `tsx --env-file=.env` ou exporte as variáveis.

Variáveis principais:

- `D4SIGN_ENVIRONMENT`: `sandbox` ou `production` da API upstream;
- `D4SIGN_TOKEN_API` e `D4SIGN_CRYPT_KEY`: ficam somente no servidor;
- `D4SIGN_REQUESTS_PER_HOUR`: cota real da conta, por exemplo `1000`; o MCP não impõe um teto fixo de 10;
- `D4SIGN_MAX_UPLOAD_BYTES`: limite local de arquivo, padrão 10 MiB e máximo 20 MiB para os endpoints deste catálogo;
- `MCP_UPLOAD_TTL_MS`: validade do `uploadHandle`, padrão 10 minutos;
- `MCP_BEARER_TOKEN`: obrigatório apenas no HTTP local com `MCP_AUTH_MODE=static`, mínimo de 32 caracteres validado no carregamento; stdio não usa bearer;
- `MCP_REQUEST_STATE_KEY`: chave de pelo menos 32 bytes para confirmações MRTR;
- `MCP_AUTH_MODE`: `static` em desenvolvimento HTTP ou `oidc` em produção;
- `OIDC_AUDIENCE` **ou** `OIDC_ALLOWED_CLIENT_IDS`: ao menos um é obrigatório no modo `oidc`. Use `OIDC_AUDIENCE` só com IdP que implementa RFC 8707; o Amazon Cognito não emite `aud` em access token e exige `OIDC_ALLOWED_CLIENT_IDS`;
- `MCP_MAX_BODY_BYTES`: corpo JSON-RPC aceito, padrão 2 MiB — precisa acomodar o base64 inline das tools binárias;
- `MCP_ANONYMOUS_REQUESTS_PER_MINUTE`: limite por origem aplicado antes da autenticação, padrão 60;
- `MCP_SHUTDOWN_GRACE_MS`: prazo de drenagem no `SIGTERM`, padrão 20 s; mantenha abaixo do `StopTimeout` da task ECS;
- `D4SIGN_CREDENTIAL_BACKEND`: `environment` local ou `aws-secrets-manager` em produção;
- `D4SIGN_CREDENTIAL_CACHE_TTL_MS`: TTL do cache local de credenciais, padrão 30 s; a invalidação entre tasks é imediata via Redis;
- `MCP_STATE_BACKEND`: `memory` local ou `redis` em produção;
- `MCP_UPLOAD_BACKEND`: `memory` local ou `s3` em produção.

Credenciais D4Sign nunca são argumentos de tool. Localmente, a conta vem do `.env`. Na AWS, o usuário autenticado cadastra/rotaciona suas credenciais fora da conversa por `PUT /credentials/d4sign`; o servidor grava um secret JSON no Secrets Manager, indexado por hash do principal. As tools recebem apenas o contexto autenticado e o `CredentialProvider` resolve a conta correta. Rotação e revogação propagam imediatamente para todas as tasks por uma geração compartilhada no Redis, em vez de esperar o TTL do cache local.

## Execução

Stdio com arquivo `.env`:

```bash
npm run build
node --env-file=.env dist/src/index.js stdio
```

HTTP de desenvolvimento:

```bash
npm run build
node --env-file=.env dist/src/index.js http
```

Rotas HTTP:

- `POST /mcp`: transporte MCP autenticado;
- `POST /uploads`: ingestão autenticada de bytes, antes das tools multipart;
- `PUT /credentials/d4sign`: cadastro/rotação autenticada no Secrets Manager, exige `d4sign:credentials:write`;
- `DELETE /credentials/d4sign`: revogação das credenciais D4Sign do principal;
- `GET /.well-known/oauth-protected-resource`: metadata RFC 9728 para descoberta OAuth;
- `GET /health/live`: liveness sem tocar dependência;
- `GET /health/ready`: verifica o estado corrente de ElastiCache e bucket e devolve 503 quando degradado, sem consumir a cota D4Sign.

### Fluxo seguro de upload

Para multipart, envie o arquivo diretamente ao servidor, sem passar conteúdo pela conversa:

```bash
curl -X POST http://127.0.0.1:3000/uploads \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/pdf" \
  -H "X-File-Name: contrato.pdf" \
  --data-binary @contrato.pdf
```

A resposta contém um `uploadHandle`. Passe-o a `d4sign_document_upload` ou `d4sign_document_attachment_upload`. O handle é vinculado a principal e tenant, expira, contém hash SHA-256 e só é apagado depois de uma resposta D4Sign bem-sucedida.

O consumo do handle é exclusivo: duas chamadas simultâneas com o mesmo handle não criam dois documentos, e o claim é devolvido em caso de falha para preservar o retry.

As duas tools binárias aceitam base64 puro de até ~1 MiB decodificado, limite coerente com `MCP_MAX_BODY_BYTES`; acima disso use `POST /uploads`. URLs arbitrárias e paths locais não são aceitos.

## Operações com confirmação humana

Oito tools exigem MRTR: envio para assinatura, cancelamento, reenvio de link, remoção de signatário, bloqueio/desbloqueio de usuário, remoção de todas as tags e remoção de todos os observadores. A primeira rodada apresenta alvo e consequência; a segunda valida confirmação assinada, argumentos, principal/tenant, uso único e uma releitura sem cache.

## Verificação

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=moderate
```

Para inspeção manual:

```bash
npx @modelcontextprotocol/inspector node \
  --env-file=/caminho/absoluto/mcp-d4sign/.env \
  /caminho/absoluto/mcp-d4sign/dist/src/index.js \
  stdio
```

## Segurança e produção AWS

Estão implementados schemas estritos, scopes internos com exigência de prefixo do resource server, JWT OIDC validado por issuer/JWKS/expiração e vinculado ao recurso por `aud` ou por client ID autorizado com `token_use=access`, metadata OAuth do recurso, autorização Cognito de menor privilégio por grupos (`readers`, `operators`, `admins`), autorização e binding MRTR fail-closed no transporte HTTP, base URLs fixas, limite/timeout/retry somente para leituras idempotentes, erros semânticos com cooldown propagado do upstream, correlação, redaction recursiva, rate limit de entrada por principal e por origem antes da autenticação, cache privado invalidado por geração compartilhada, cota configurável por conta, auditoria de mutação e de download, validação de arquivo, handles temporários com consumo exclusivo e MRTR para oito operações.

O perfil `NODE_ENV=production` falha no boot se OIDC, Secrets Manager/KMS, Redis, S3, verificação antimalware, URL pública ou chave MRTR não estiverem configurados. A imagem Docker é não-root e fixada por digest, com `npm ci --ignore-scripts`; CloudFormation e workflows GitHub Actions estão versionados.

A stack habilita GuardDuty Malware Protection com condição de origem na role, WAF regional com regra rate-based, access logs do ALB, egress restrito nas tasks, MFA obrigatória no user pool, `maxmemory-policy=noeviction` no ElastiCache e alarmes com destino SNS para 5xx, 4xx, latência p95, memória/eviction do Redis e falhas de scan. O servidor só consome objetos marcados como `NO_THREATS_FOUND` e apaga a versão do objeto ao consumir ou rejeitar.

Ainda são responsabilidades do ambiente: cadastrar/federar usuários, atribuir grupos, configurar callbacks do Cognito, DNS no Route 53, NAT Gateway ou VPC endpoints nas subnets privadas, confirmar a assinatura do tópico de alarmes e homologar chamadas reais com fixtures próprias de sandbox.

Detalhes: [catálogo](docs/tool-catalog.md), [contratos](docs/d4sign-endpoint-contracts.md), [arquitetura](docs/architecture.md), [autenticação](docs/auth-model.md), [operação/AWS](docs/operations.md), [comparação de engenharia](docs/rd-comparison-improvements.md), [ameaças](docs/threat-model.md) e [relatório](docs/development-report.md).
