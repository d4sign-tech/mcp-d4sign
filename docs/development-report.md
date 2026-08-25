# Relatório de desenvolvimento — catálogo completo

Data de fechamento: 2026-08-14.

## Resultado

As 42 operações exigidas por `D4Sign_MCP_SKILL.md` estão implementadas e registradas no servidor MCP. A solução possui transporte stdio e Streamable HTTP, cliente D4Sign centralizado, schemas estritos, autorização por scopes, cache/cota, auditoria, upload seguro e confirmação humana para ações sensíveis.

Uma sprint posterior de maturidade incorporou os padrões compatíveis identificados em uma análise comparativa confidencial: Cognito/OIDC, Secrets Manager por principal, ElastiCache Redis, S3/GuardDuty, rate limit, erros semânticos, correlação/redaction, retry idempotente, container, CI/CD e CloudFormation. Nenhum arquivo do projeto de referência foi modificado ou copiado.

O catálogo está dividido em:

- 15 consultas originais de cofres, documentos, templates, signatários, usuários, tags, observadores e webhooks;
- 27 operações adicionais de organização, lotes, arquivos, templates, signatários, administração e remoção;
- oito operações MRTR: envio, cancelamento, reenvio, remoção de signatário, bloqueio, desbloqueio, remoção de todas as tags e de todos os observadores.

A lista nominal e os endpoints estão em [tool-catalog.md](tool-catalog.md) e [d4sign-endpoint-contracts.md](d4sign-endpoint-contracts.md).

## Arquitetura entregue

- `D4SignClient`: base URL fixa por ambiente, credenciais em query somente internamente, timeout, cancelamento, limite de resposta, redirect bloqueado e erros seguros.
- `D4SignReadService`: leituras normalizadas, cache privado, TTL curto para estado mutável, deduplicação e variantes sem cache para revalidação.
- `D4SignWriteService`: contratos JSON, auditoria mínima e invalidação direcionada após sucesso.
- `D4SignFileService`: multipart por handle, base64 limitado, hash SHA-256, exclusão após sucesso e download por URL temporária.
- `CredentialProvider`: ambiente local, Secrets Manager por identidade em produção e mock em testes; tools nunca recebem tokens.
- `QuotaManager`: limite por conta, local ou Redis distribuído, sem teto fixo de dez.
- `ConfirmationWorkflow`: HMAC, cinco minutos, vínculo a método/principal/tenant/argumentos/snapshot e replay Redis atômico em produção.
- `buildServer`: uma factory compartilhada por HTTP e stdio, catálogo determinístico.

## Arquivos e uploads

Foi criada a rota autenticada `POST /uploads`. Ela recebe bytes crus, `Content-Type` e `X-File-Name`, valida limite, nome sem path, extensão, MIME permitido e assinatura binária. O resultado é um UUID opaco vinculado ao principal e tenant, com expiração e hash.

O armazenamento em memória:

- faz cópias defensivas reais dos bytes;
- impede acesso cruzado entre principal/tenant;
- zeroiza conteúdo ao consumir ou expirar;
- mantém o handle quando a D4Sign falha, permitindo nova tentativa consciente;
- remove o handle somente após sucesso upstream.

Não há fetch de URL arbitrária nem leitura de paths informados pelo modelo. Base64 aceita somente conteúdo puro e limitado. O download não grava arquivo: devolve nome e URL HTTPS temporária, rejeitando credenciais D4Sign na query.

## Regras das operações novas

- lote: 1 a 25 UUIDs únicos;
- templates HTML/Word: IDs explícitos e variáveis limitadas, sem sobrescrita por ID repetido;
- cadastro de signatários: 1 a 25 e-mails únicos, fase 2, ações 1–13, flags convertidas ao formato D4Sign e validação das combinações de autenticação;
- alteração/informações de signatário: correspondência única de e-mail e chave, com alvo ainda não assinado;
- desbloqueio: usuário precisa estar bloqueado, com MRTR e nova verificação;
- remoção específica de tag/observador: alvo exato precisa existir;
- remoções abrangentes: snapshot ordenado, MRTR e releitura sem cache;
- URL de download: HTTPS e sem `tokenAPI`/`cryptKey`.

## Segurança

- credenciais não aparecem em inputs, outputs, logs ou erros;
- base URL D4Sign não pode ser escolhida por tool;
- schemas rejeitam propriedades extras e limitam strings/arrays/base64;
- scopes internos separam leitura, escrita, envio, cancelamento, download e administração;
- nomes e textos upstream são tratados como dados não confiáveis;
- logs de mutação não incluem e-mail, tag, nome de arquivo, base64 ou URL temporária;
- Host, Origin, bearer e tamanho de body são validados antes do handler HTTP;
- cache é separado por tenant e fingerprint irreversível da conta;
- nenhuma mutação POST recebe retry automático.

## Testes e verificação

Estado no fechamento:

- 19 arquivos de teste;
- 69 testes passando;
- catálogo E2E com exatamente 42 tools;
- negociação MCP `2026-07-28` e chamada de leitura;
- aceite/recusa MRTR e remoção abrangente ponta a ponta;
- schemas, respostas upstream, scopes, cache, cota e confirmação;
- método, path, query e body das famílias de endpoints com mock HTTP;
- multipart, binário, download, expiração, isolamento e falha de upload;
- `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` aprovados;
- `npm audit --audit-level=moderate`: zero vulnerabilidades conhecidas.

## Correções relevantes encontradas durante a conclusão

- os handles de arquivo passaram a usar `Uint8Array.from`; `Buffer.slice()` compartilhava memória e podia zerar outro upload ao consumir o primeiro;
- informações pessoais enviadas a `addinfo` deixaram de vazar como propriedades extras na saída normalizada;
- cadastro de signatários passou a enviar `act` e flags obrigatórias como strings, conforme os exemplos oficiais;
- MIME agora precisa ser coerente simultaneamente com extensão e assinatura binária;
- a cota local respeita `D4SIGN_REQUESTS_PER_HOUR`, permitindo configurar as 1.000 requisições da conta do desenvolvedor.

## Controles de produção implementados

- JWT OIDC/Cognito com issuer/audience/JWKS/scopes, metadata RFC 9728 e resource binding;
- grupos Cognito `readers`/`operators`/`admins` com supressão de scopes por Lambda Pre Token Generation V2 e negação por padrão;
- onboarding/rotação/revogação de credenciais D4Sign fora da conversa;
- AWS Secrets Manager com KMS, task role e isolamento por hash do principal/tenant;
- Redis para cache, cota por conta, rate limit e replay MRTR atômico, com ACL limitada ao prefixo e aos comandos usados;
- S3 privado para upload compartilhado, GuardDuty on-upload e consumo somente após `NO_THREATS_FOUND`;
- erro semântico versionado e retry apenas para GET transitório;
- logs correlacionados e sanitizados sem body de tool;
- Docker multi-stage não-root, GitHub Actions e infraestrutura CloudFormation AWS;
- fail-fast: `NODE_ENV=production` exige todos os backends seguros.

## Pendências externas para go-live

- cadastro/federação de usuários, atribuição de grupos, callbacks e consentimento no Cognito;
- VPC/subnets/NAT ou endpoints, AWS WAF, egress, Route 53 e ACM;
- validar região, cota, custos e alertas do GuardDuty Malware Protection;
- ações SNS, dashboards, alertas e tracing no CloudWatch;
- homologação dos contratos de escrita com fixtures explícitas no sandbox;
- revisão de segurança/LGPD e runbook corporativo de DR;
- validar o formato de `birthday` e respostas com divergências registradas em [api-contract-notes.md](api-contract-notes.md).

## Comentário curto para a tarefa

> Catálogo MCP D4Sign concluído com 42 tools. A sprint de maturidade AWS adicionou Cognito/OIDC com grupos e menor privilégio, credenciais por principal no Secrets Manager/KMS, ElastiCache distribuído para cache/cota/rate limit/replay, S3 com GuardDuty e bloqueio até resultado limpo, erros semânticos, telemetria segura, retry idempotente, Docker, CI/CD e CloudFormation. Próximos passos: provisionar a stack AWS, atribuir os grupos de acesso, validar os controles operacionais da conta e homologar as mutações com fixtures isoladas do sandbox.
