# Plano por sprints

## Sprint 1 — Fundação e vertical slice de leitura

Status: implementada.

Objetivo: validar a arquitetura MCP/D4Sign com exatamente cinco endpoints seguros de leitura.

Entregas:

- SDK MCP v2 estável e protocolo `2026-07-28`;
- entradas Streamable HTTP e stdio;
- cliente D4Sign centralizado;
- providers de credencial por ambiente e mock;
- cache privado, deduplicação e cota local;
- autorização por scope;
- cinco tools: cofres, documentos, documento específico, signatários e tags;
- testes unitários, integração HTTP mock e E2E MCP moderno;
- contratos e divergências documentais registrados.

Não incluído: qualquer sexta operação do catálogo original.

## Sprint 2 — Demais leituras

Status: implementada.

Objetivo: ampliar o catálogo em exatamente mais cinco operações de leitura, mantendo o padrão validado na Sprint 1.

Entregas:

- `d4sign_vault_documents_list`;
- `d4sign_vault_folders_list`;
- `d4sign_documents_list_by_phase`;
- `d4sign_templates_list` — leitura cujo contrato D4Sign usa `POST`;
- `d4sign_document_attachments_list`;
- parsers normalizados para pastas, templates e anexos;
- paginação por página nos endpoints em que `pg` é documentado;
- limites locais que não alteram a chave de cache nem consomem nova chamada upstream;
- testes dos cinco métodos/paths, catálogo acumulado com dez tools e documentação atualizada.

As diferenças de formato que dependem do comportamento real do sandbox continuam registradas como bloqueios de contrato, sem campos ou rotas inventados.

## Sprint 3 — Grupos, usuários e integrações

Status: implementada.

Objetivo: concluir mais cinco consultas de conta, signatários e documentos sem introduzir mutações.

Entregas:

- `d4sign_signature_groups_list`;
- `d4sign_signature_group_get`;
- `d4sign_user_verify` — leitura cujo contrato D4Sign usa `POST`;
- `d4sign_document_observers_list`;
- `d4sign_document_webhooks_list` — leitura sensível com scope próprio;
- novos scopes de usuários, observadores e webhooks;
- normalização de flags e membros dos grupos, com descarte de campos não selecionados;
- limites locais para grupos, membros e observadores;
- testes dos cinco métodos, paths e body, catálogo acumulado com quinze tools e documentação atualizada.

O download permanece na sprint de arquivos por exigir tratamento específico de URL temporária/conteúdo.

## Sprint 4 — Escritas não destrutivas

Status: implementada.

Objetivo: introduzir exatamente cinco alterações de baixo risco, sem remoções, operações administrativas ou fluxos de arquivos.

Entregas:

- `d4sign_vault_folder_create`;
- `d4sign_vault_folder_rename`;
- `d4sign_document_tags_add`;
- `d4sign_document_mark_urgent`;
- `d4sign_document_observer_add`;
- `D4SignWriteService` separado do serviço de leitura;
- schemas estritos, uma tag por chamada e rejeição de caracteres de controle;
- perfil de observador `1` (somente visualização) como padrão de menor privilégio;
- auditoria por principal, tenant, operação e UUID, sem registrar nomes, tags ou e-mails;
- invalidação dos caches de pastas, tags e observadores após sucesso;
- proteção do cache contra reinserção de resposta antiga que estava pendente durante uma mutação;
- testes dos cinco métodos, paths, bodies, auditoria, invalidação e annotations MCP.

## Sprint 5 — Operações sensíveis e MRTR

Status: implementada.

Objetivo: entregar exatamente cinco mutações sensíveis com confirmação humana verificável antes de qualquer efeito externo ou destrutivo.

Entregas:

- `d4sign_document_send_for_signature`;
- `d4sign_document_cancel`;
- `d4sign_document_signature_link_resend`;
- `d4sign_document_signer_remove`;
- `d4sign_user_block`;
- MRTR MCP compatível com a revisão `2026-07-28` e com o shim legado do SDK;
- `requestState` assinado com HMAC-SHA-256, validade de cinco minutos e vínculo ao método, principal e tenant;
- confirmação vinculada ao hash dos argumentos e ao snapshot do documento, signatários ou usuário;
- consumo atômico de uso único para prevenir replay;
- releitura sem cache e validação de fase, identidade e status após o aceite;
- invalidação da confirmação se o alvo mudar entre a revisão humana e a mutação;
- scopes separados para envio, cancelamento, escrita de signatários e administração de usuários;
- testes dos cinco contratos upstream e do fluxo de aceite, recusa, adulteração, vínculo e replay.

## Sprint 6 — Arquivos

Status: implementada.

Entregas:

- uploads principal/anexo por `uploadHandle` e por base64;
- `POST /uploads` autenticado, armazenamento temporário isolado e expiração;
- validação de tamanho, MIME permitido, extensão, assinatura binária e SHA-256;
- multipart sem `Content-Type` manual e remoção do handle somente após sucesso;
- download por URL HTTPS temporária, sem download automático nem credenciais refletidas;
- testes de isolamento, expiração, falha upstream, multipart, binário e download.

Antimalware e armazenamento distribuído permanecem requisitos de implantação, não do protótipo local.

## Sprint 7 — Criação e signatários

Status: implementada.

Entregas:

- lotes de 1 a 25 documentos;
- criação por templates HTML e Word;
- cadastro de signatários com regras de autenticação, alteração de e-mail por chave exata e inclusão de informações presenciais;
- scopes de escrita de documentos e download;
- testes de método, path, body e normalização.

## Sprint 8 — Remoções e administração

Status: implementada.

Entregas:

- desbloqueio administrativo com MRTR;
- remoção de tag explícita, todas as tags com MRTR e marca urgente;
- remoção de observador explícito e todos os observadores com MRTR;
- snapshots ordenados e releitura sem cache para remoções abrangentes;
- catálogo acumulado com exatamente 42 tools.

## Sprint 9 — Documentação e endurecimento

Status: implementada para desenvolvimento.

Entregas:

- contratos e catálogo das 42 operações;
- testes de schemas, arquivos, HTTP, services e E2E MCP;
- documentação de fluxo de upload, configuração e riscos residuais;
- typecheck, lint, suíte, build e auditoria executados no fechamento.

## Sprint 10 — Maturidade de produção AWS

Status: mecanismos de aplicação e infraestrutura implementados.

Entregas:

- Resource Server OIDC/Cognito e metadata OAuth RFC 9728;
- isolamento de credenciais por principal/tenant no Secrets Manager/KMS;
- Redis para cache, cota, rate limit e replay MRTR;
- S3 para uploads compartilhados;
- erros semânticos, correlação, redaction e retry de GET;
- Docker, CI/CD, CloudFormation e runbook AWS;
- GuardDuty Malware Protection for S3 com consumo bloqueado até resultado limpo;
- configuração de produção fail-fast e testes dos novos controles.

Gates externos de go-live: Cognito/federação/callbacks, domínio/VPC/WAF, validação operacional do GuardDuty, alertas e homologação D4Sign real.
