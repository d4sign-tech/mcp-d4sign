# Arquitetura do catálogo completo

```text
Tool MCP
  -> JWT OIDC/Cognito validado no transporte (produção)
  -> scopes previamente limitados por grupos no Pre Token Generation V2
  -> autorização por scope
  -> D4SignReadService (leituras)
      -> cache privado + deduplicação (Redis em produção)
      -> CredentialProvider
          -> Environment (local) ou AWS Secrets Manager (produção)
      -> D4SignClient
          -> quota distribuída por fingerprint e limite da conta
          -> fetch para host D4Sign fixo
          -> limite/timeout/parsing
  -> normalização validada
  -> structuredContent MCP

Tool MCP de escrita
  -> autorização por scope de escrita
  -> D4SignWriteService
      -> auditoria de início
      -> D4SignClient
      -> normalização da resposta
      -> invalidação direcionada de cache
      -> auditoria de sucesso/falha

Arquivo multipart
  -> POST /uploads autenticado
  -> validação nome + extensão + MIME + assinatura + tamanho
  -> UploadStore vinculado a principal/tenant e TTL (S3 em produção)
  -> uploadHandle opaco
  -> tool MCP -> D4SignFileService -> multipart D4Sign
  -> exclusão após sucesso: zeroização em memória, DeleteObjectVersion no S3

Tool MCP sensível
  -> autorização por scopes de mutação e leitura
  -> primeira rodada: leitura do alvo + formulário de confirmação
  -> requestState HMAC (5 min, principal/tenant, args e snapshot)
  -> consumo anti-replay atômico no Redis
  -> segunda rodada: validação + consumo anti-replay
  -> releitura sem cache + comparação do snapshot
  -> D4SignWriteService + invalidação + auditoria
```

O modo HTTP cria uma instância MCP por requisição com `createMcpHandler`, sem `Mcp-Session-Id`. Cache, cota, rate limit e replay são dependências externas à instância MCP. O perfil local usa memória; o perfil AWS usa ElastiCache Redis compartilhado. O stdio usa `serveStdio` e compartilha a mesma factory.

As credenciais D4Sign ficam atrás de `CredentialProvider`. Em produção, o Secrets Manager resolve o secret criptografado por KMS a partir do hash do principal/tenant autenticado e mantém cache curto por processo. Identidade nunca vem de argumento da tool. Em stdio, o contexto é explicitamente single-tenant local.

Em produção horizontal, `RedisPrivateCache`, `RedisQuotaManager`, `RedisRateLimiter` e `RedisReplayStore` usam operações atômicas/TTL no ElastiCache. `AwsSecretsManagerCredentialProvider` e `S3UploadStore` usam as credenciais temporárias do ECS task role. O boot de produção é recusado se qualquer backend distribuído ou a configuração OIDC estiver ausente.

Listagens paginadas são armazenadas no cache por conta, tenant, operação e página upstream. O parâmetro `limit` é aplicado somente depois da leitura do cache; solicitar a mesma página com outro limite não consome novamente a cota D4Sign.

As leituras de usuário, observadores e webhooks usam scopes próprios. A URL de webhook é tratada como saída sensível: ela não é incluída no texto resumido nem nos logs, mas permanece no `structuredContent` para o principal explicitamente autorizado com `d4sign:webhooks:read`.

As escritas usam scopes separados das leituras. A auditoria registra apenas principal, tenant, ação, tipo/UUID do alvo e resultado. Nomes de pasta, tags, e-mails e bytes/base64 não são registrados. A geração de URL de download também emite evento de auditoria, sem incluir a URL nem o nome do arquivo.

A invalidação de cache é por escopo `tenant:conta:operação` e usa um contador de geração compartilhado, incrementado na mutação. A geração corrente compõe a chave física, então: invalidar é O(1) sem varredura de keyspace; uma leitura iniciada antes da mutação grava sob geração superada e é inalcançável; e uma falha de invalidação afeta apenas a conta da mutação, limitada ao TTL da entrada, sem limpeza global. As duas implementações de cache — memória e Redis — são exercitadas pelo mesmo contrato de testes para não divergirem em garantias.

Oito operações sensíveis usam MRTR. O `requestState` contém somente UUID aleatório e hashes SHA-256 de argumentos/snapshot, é assinado por HMAC-SHA-256, expira em cinco minutos e é vinculado ao método MCP, principal e tenant sem expor esses identificadores no valor. A confirmação é consumida antes da releitura; em produção, `SET NX PX` no Redis impede replay entre réplicas. O estado atual do alvo é buscado fora do cache e precisa produzir o mesmo hash mostrado na confirmação.

Uploads multipart não aceitam path ou URL vindos do modelo. A rota `/uploads` recebe bytes do cliente autenticado e devolve um handle UUID. Localmente há `Map` com zeroização e teto por principal; na AWS, o objeto S3 privado guarda somente hashes de identidade, metadados codificados, SHA-256 e expiração.

O consumo do handle é exclusivo: um claim atômico (`SET NX PX` no Redis) impede que duas chamadas simultâneas com o mesmo handle criem dois documentos, e o claim é devolvido em caso de falha para preservar o retry. A verificação antimalware é consultada por `GetObjectTagging` **antes** do `HeadObject`, porque a bucket policy nega `s3:GetObject` de objeto sem a tag limpa e `HeadObject` é autorizado como `s3:GetObject`: sem essa ordem, a janela normal de análise devolveria `AccessDenied` opaco em vez do erro transitório `UPLOAD_SCAN_PENDING`. Um 403 nessa fase também é mapeado para erro transitório. Resultados reprovados têm a versão do objeto apagada.

As tools binárias validam base64 antes de decodificar, com teto coerente com o corpo aceito pelo transporte; acima disso o caminho é `POST /uploads`. O download apenas normaliza a URL HTTPS devolvida pela D4Sign e nunca a acessa ou registra.

A autorização por scope e o binding da confirmação MRTR são vinculados ao transporte: no HTTP, a ausência de contexto autenticado é falha fechada, e não recai no principal local de stdio.

`MCP_REQUEST_STATE_KEY` é injetada como secret em todas as réplicas. Logs carregam `requestId`, tool, rota sanitizada, status e duração, mas não payloads; erros de tool usam um contrato semântico com categoria, código, retryability e ação sugerida. Requisições GET transitórias podem ter uma repetição com backoff/jitter; mutações nunca são repetidas automaticamente.
