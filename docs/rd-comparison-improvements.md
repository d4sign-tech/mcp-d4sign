# Melhorias de engenharia adotadas após a análise comparativa

Este documento registra somente padrões de engenharia transferíveis. Não reproduz código, regras de negócio, endpoints, nomes internos, credenciais ou detalhes proprietários do projeto usado como referência.

## Matriz de decisão

| Padrão observado em MCP maduro | Situação anterior no D4Sign | Implementação no D4Sign |
|---|---|---|
| Conexão por usuário, sem token upstream no prompt | Conta única no `.env` | `CredentialProvider` por identidade e onboarding autenticado fora da conversa |
| Segredos protegidos por serviço de chaves | Apenas variável local | AWS Secrets Manager + KMS por hash do principal/tenant e ECS task role |
| OAuth no endpoint MCP | Bearer estático de desenvolvimento | Resource Server OIDC/Cognito, JWT/JWKS, issuer/audience, resource binding, grupos com supressão de scopes, PRM RFC 9728 e challenge 401 |
| Limite MCP separado do limite da API | Somente cota D4Sign | Rate limit por principal/rota e cota upstream por fingerprint/limite da conta |
| Estado coordenado entre réplicas | Mapas em memória | ElastiCache Redis para cache, cota, rate limit e replay MRTR |
| Arquivos temporários compartilhados | Bytes em memória | S3 privado, identidade vinculada por hash, SHA-256, expiração e bloqueio até resultado limpo do GuardDuty |
| Erros úteis para agentes | Texto genérico | Contrato semântico versionado com categoria, código, retryability e ação sugerida |
| Retry consciente da operação | Sem retry | Uma repetição somente para GET transitório, com backoff/jitter e nova reserva de cota |
| Telemetria correlacionada e sanitizada | Logs pontuais | `requestId`, tool/rota/status/duração/tentativa, rotas normalizadas e sanitizer recursivo |
| Proteção de ações sensíveis | MRTR local | MRTR preservado e anti-replay atômico distribuído |
| Artefato e pipeline reproduzíveis | Sem container/CI | Docker multi-stage não-root, lockfile, CI e deploy AWS por GitHub OIDC |
| Infraestrutura declarativa | Runbook conceitual AWS | CloudFormation para ECS/ALB, Cognito, Secrets Manager, S3, GuardDuty, ElastiCache, IAM, health e escala |
| Testes de controles críticos | Catálogo e serviços | Casos adicionais de produção, isolamento, redaction, rate limit, OAuth metadata e retry |

## O que não foi copiado

Não pertencem ao escopo deste MCP e, portanto, não foram replicados:

- catálogo web genérico de conectores;
- transformação dinâmica de OpenAPI em tools;
- painel administrativo do produto de referência;
- banco relacional e modelos específicos daquele negócio;
- analytics de produto/marketing;
- infraestrutura do provedor de nuvem usado pelo projeto de referência;
- OAuth próprio para APIs upstream que já usam outro modelo de credencial.

O D4Sign MCP continua deliberadamente específico: 42 tools tipadas, contratos normalizados e regras de confirmação próprias da assinatura eletrônica.

## Diferenças intencionais

- Secrets Manager com KMS substitui envelope encryption em banco porque o D4Sign MCP não persiste tokens upstream em uma base própria.
- Cognito/OIDC valida a identidade MCP; `tokenAPI`/`cryptKey` permanecem credenciais separadas da API D4Sign e nunca há token passthrough.
- ElastiCache usa TLS e RBAC; a senha é gerada no Secrets Manager e injetada somente no runtime do ECS, e a ACL permite apenas o prefixo e os comandos necessários.
- S3 substitui armazenamento local para permitir múltiplas tasks.
- Retries são ainda mais conservadores: nunca repetem mutações automaticamente.

## Pendências externas ao código

Os controles abaixo exigem configuração organizacional e não podem ser concluídos apenas por commit:

- cadastro/federação de usuários, atribuição dos grupos Cognito e callback URLs permitidos;
- Route 53, ACM, subnets/NAT/VPC endpoints, AWS WAF e política de egress;
- validação de disponibilidade regional, cota, custo e alertas do GuardDuty Malware Protection;
- ações de alarmes, dashboards, orçamento e retenção no CloudWatch;
- fixtures D4Sign de sandbox e homologação das mutações;
- revisão de segurança, LGPD e processo de suporte/rotação.
