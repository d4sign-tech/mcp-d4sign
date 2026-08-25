# Threat model — catálogo completo

## Ativos e fronteiras

- bearer token MCP de desenvolvimento;
- `tokenAPI` e `cryptKey` D4Sign;
- metadados de documentos, dados de signatários/observadores, status de usuários e URLs de webhook;
- organização de cofres, tags e permissões de observadores alteráveis pelas tools de escrita;
- fase de documentos, vínculos de signatários, mensagens externas e acesso de usuários alteráveis pelas tools sensíveis;
- bytes temporários de upload, hashes e URLs temporárias de download;
- fronteiras cliente MCP → servidor MCP e servidor MCP → D4Sign.

## Ameaças mitigadas nesta sprint

- vazamento de token: credenciais não são argumentos, outputs ou URLs de erro; logger aplica redaction;
- SSRF: ambiente escolhe uma de duas base URLs constantes e tools não aceitam URL;
- confused deputy/elevação de privilégio: scopes são verificados por handler, tenant vem da autenticação e o Cognito suprime scopes não autorizados conforme grupos com negação por padrão;
- prompt injection em nomes/tags: dados upstream permanecem em campos estruturados e têm limites;
- exaustão da cota: quota local, cache privado e deduplicação;
- excesso de dados pessoais: normalização remove IP, geolocalização, documento, senha e user-agent;
- descoberta indevida: usuários, observadores e webhooks exigem scopes internos separados; URLs de webhook não aparecem no resumo textual nem em logs;
- escrita indevida: scopes de escrita são distintos, UUIDs são exatos e inputs rejeitam campos extras/caracteres de controle;
- cache obsoleto após escrita: mutações invalidam somente os escopos da própria conta, por contador de geração compartilhado no Redis; uma leitura iniciada antes da mutação grava sob geração superada e nunca volta a ser lida. A falha de invalidação é auditada e limitada ao TTL da entrada, sem limpeza global que atingiria outros tenants;
- vazamento por auditoria: registros de mutação omitem nomes de pasta, tags, e-mails, bodies e credenciais;
- DNS rebinding/origin: HTTP valida Host e Origin e faz bind local por padrão;
- resposta maliciosamente grande: limite em bytes e redirects desabilitados.
- upload arbitrário/SSRF: tools não buscam URLs; multipart usa handle opaco e base64 possui limite anterior à decodificação;
- confusão de arquivo: nome não aceita paths, extensão/MIME/assinatura binária precisam ser coerentes e o handle é vinculado a principal/tenant;
- retenção indevida: em memória os bytes são copiados defensivamente e zeroizados no consumo/expiração; no S3 o consumo apaga a versão específica do objeto (`DeleteObjectVersion`), e não apenas cria um delete marker que deixaria o conteúdo recuperável;
- execução sensível sem intenção humana: oito operações retornam `input_required` e exigem um formulário booleano explícito antes da mutação;
- adulteração de confirmação: `requestState` usa HMAC-SHA-256, expiração de cinco minutos e vínculo ao método, principal e tenant;
- troca de argumentos/TOCTOU: hashes canônicos vinculam a confirmação aos argumentos e ao snapshot; o alvo é relido sem cache após o aceite e qualquer diferença encerra o fluxo;
- replay: cada UUID de confirmação aceita ou recusada é consumido uma única vez antes da releitura/mutação;
- replay multi-réplica: produção usa consumo atômico `SET NX PX` no ElastiCache Redis;
- token MCP indevido: JWT OIDC valida assinatura, issuer, expiração, tenant e o vínculo com este recurso. Com IdP que implementa RFC 8707, o vínculo é `aud`. Com Amazon Cognito, que não emite `aud` em access token, o vínculo é o client ID autorizado somado a `token_use=access` obrigatório — um ID token nunca é aceito. Token de entrada nunca é repassado à D4Sign;
- elevação por scope não emitido: com prefixo de resource server configurado, apenas scopes prefixados são aceitos; um scope sem prefixo não passou pelo resource server deste recurso e é descartado. A claim `roles` é ignorada, para que a supressão feita na Lambda não possa ser contornada por outro caminho de emissão;
- ausência de contexto autenticado no transporte HTTP: falha fechada tanto na autorização por scope quanto no binding da confirmação MRTR, em vez de recair no principal local de stdio;
- perda silenciosa de garantia por pressão de memória: o ElastiCache usa `maxmemory-policy=noeviction`, para que anti-replay e cota falhem de forma explícita em vez de serem evictados; há alarme de memória e de eviction;
- flood não autenticado: rate limit por origem antes de qualquer validação criptográfica, e WAF com regra rate-based no ALB;
- vazamento de credencial por onboarding: cadastro autenticado acontece fora do chat, responde sem body e grava no Secrets Manager por hash de identidade;
- abuso do MCP: rate limit por principal/rota é separado da cota upstream e devolve `Retry-After`; o `Retry-After` de um 429 da própria D4Sign é propagado como `cooldownSeconds` no erro semântico;
- retry destrutivo: somente GET pode ser repetido automaticamente; cada tentativa reserva cota;
- correlação sem payload: logs carregam IDs/durações/resultados, sanitizam segredos e normalizam UUIDs em rotas;
- prompt injection no formulário: nomes, mensagens e identificadores são limitados, caracteres de controle são substituídos e os dados upstream são rotulados como dados, não instruções;
- destinatário incorreto: reenvio e remoção exigem correspondência única de `documentUuid`, e-mail e `keySigner`, além de signatário ainda pendente;

## Riscos residuais e controles do ambiente

- usuários/federação, atribuição de grupos, consentimento, callback URLs e compatibilidade do cliente MCP com o IdP precisam ser operados no Cognito;
- rotação e revogação de credenciais D4Sign propagam entre tasks pela geração compartilhada no Redis; se o Redis estiver indisponível, a propagação volta a ser limitada ao TTL local de 30 s;
- Secrets Manager/ElastiCache/S3 usam task roles, KMS, TLS e uploads falham fechado até o resultado limpo do GuardDuty; WAF, egress das tasks e access logs do ALB estão na stack, mas a topologia de VPC (NAT/VPC endpoints) depende da conta real;
- a tag do GuardDuty é reforçada por bucket policy; SCPs, alertas e revisão periódica do IAM continuam obrigatórios;
- formatos upstream e todas as mutações ainda precisam de homologação com fixtures explícitas no sandbox;
- URLs temporárias de download permanecem segredos de curta duração no cliente autorizado;
- logs estruturados existem, mas alertas/dashboards e retenção são configuração operacional;
- o endpoint de onboarding precisa de proteção de UX, suporte e política de rotação/revogação;
- DDoS/WAF, egress, backup, DR e compliance/LGPD dependem da arquitetura corporativa.

O código contém os mecanismos necessários ao perfil AWS, mas produção só deve ser declarada após esses controles externos e a homologação de sandbox serem evidenciados.
