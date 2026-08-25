# Contratos D4Sign — 42 tools

Verificação documental: Sprints 1 a 5 entre 2026-07-31 e 2026-08-12; catálogo restante revisado em 2026-08-14. Base URLs oficiais:

- sandbox: `https://sandbox.d4sign.com.br/api/v1/`;
- produção: `https://secure.d4sign.com.br/api/v1/`.

Em todos os endpoints abaixo, `tokenAPI` é enviado em query pelo cliente interno. `cryptKey` também é enviado quando configurado para a conta. Nenhuma dessas credenciais aparece no schema MCP.

## d4sign_vaults_list

- Operação oficial: Listar todos os cofres.
- Método: `GET`.
- Path: `/safes`.
- Path params: nenhum.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não documentada.
- Resposta de sucesso documentada: objetos com `uuid-safe` e `name-safe`.
- Resposta observada em produção em 2026-08-12: `uuid_safe` e `name-safe`. O parser aceita ambas as grafias, normaliza para `uuid` e rejeita a resposta se as duas estiverem presentes com valores diferentes.
- Erros documentados na referência: `400`; o cliente também mapeia códigos HTTP usuais de forma segura.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 5 minutos.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-cofres> e <https://docapi.d4sign.com.br/docs/endpoints>.

## d4sign_documents_list

- Operação oficial: Listar todos os documentos.
- Método: `GET`.
- Path: `/documents`.
- Path params: nenhum.
- Query params: `tokenAPI`, `cryptKey` quando aplicável e `pg` para a página.
- Body: nenhum.
- Paginação: até 500 documentos por página segundo o guia oficial; o primeiro objeto contém metadados de paginação. A tool busca somente a página solicitada e devolve no máximo 100 itens.
- Resposta de sucesso documentada: lista de documentos com `uuidDoc`, `nameDoc`, `type`, `size`, `pages`, `uuidSafe`, `safeName`, `statusId` e `statusName`, entre outros campos.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 1 minuto.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-todos-os-documentos> e <https://docapi.d4sign.com.br/docs/endpoints-2>.

## d4sign_document_get

- Operação oficial: Listar um documento específico.
- Método: `GET`.
- Path: `/documents/{uuid-document}`.
- Path params: UUID exato do documento.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não.
- Resposta de sucesso documentada: um documento com os mesmos campos principais da listagem.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 15 segundos.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-um-documento-espec%C3%ADfico> e <https://docapi.d4sign.com.br/docs/endpoints-2>.

## d4sign_document_signers_list

- Operação oficial: Listar signatários de um documento.
- Método: `GET`.
- Path: `/documents/{uuid-document}/list`.
- Path params: UUID exato do documento.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não documentada.
- Resposta de sucesso documentada: documento com campo `list`; cada signatário pode conter `key_signer`, `user_name`, `email`, `signed`, `embed_methodauth`, `date` e diversos dados sensíveis.
- Normalização: somente chave, nome, e-mail, status, método de autenticação e data de inclusão são expostos. IP, geolocalização, documento pessoal, senha e user-agent são descartados.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 15 segundos.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-signat%C3%A1rios-de-um-documento> e <https://docapi.d4sign.com.br/docs/endpoints-1>.

## d4sign_document_tags_list

- Operação oficial: Listar as TAGs do documento.
- Método: `GET`.
- Path: `/tags/{uuid-documento}`.
- Path params: UUID exato do documento.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não implementada; o texto de paginação do guia aponta incorretamente para `users/list`, registrado como divergência documental.
- Resposta de sucesso documentada: `uuid_arquivo` e `TAGs` como texto separado por vírgulas.
- Normalização: `TAGs` é convertido em uma lista limitada a 500 itens de 256 caracteres.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 15 segundos.
- Restrição documentada: permissões da conta/cofre podem limitar a operação.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-as-tags-do-documento> e <https://docapi.d4sign.com.br/docs/endpoints-3>.

## d4sign_vault_documents_list

- Operação oficial: Listar todos os documentos de um cofre ou pasta.
- Método: `GET`.
- Paths: `/documents/{uuid-safe}/safe` e `/documents/{uuid-safe}/safe/{uuid-folder}` quando a pasta é informada.
- Path params: UUID exato do cofre; UUID exato e opcional da pasta.
- Query params: `tokenAPI`, `cryptKey` quando aplicável e `pg` para a página.
- Body: nenhum.
- Paginação: até 500 documentos por página segundo o guia oficial; a tool busca somente a página solicitada e devolve até 100 itens.
- Resposta de sucesso documentada: lista com o mesmo formato de documento usado por `/documents`.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 1 minuto, por cofre, pasta e página.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-todos-os-documentos-de-um-cofre-ou-pasta> e <https://docapi.d4sign.com.br/docs/endpoints>.

## d4sign_vault_folders_list

- Operação oficial: Listar pastas do cofre.
- Método: `GET`.
- Path: `/folders/{uuid-safe}/find`.
- Path params: UUID exato do cofre.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não documentada; o limite MCP é aplicado localmente.
- Resposta de sucesso documentada: lista com `uuid_safe`, `uuid_folder`, `name` e `dt_cadastro`.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 5 minutos.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-pastas-do-cofre> e <https://docapi.d4sign.com.br/docs/endpoints>.

## d4sign_documents_list_by_phase

- Operação oficial: Listar todos os documentos de uma fase.
- Método: `GET`.
- Path: `/documents/{id-fase}/status`.
- Path params: fase `1` processando, `2` aguardando signatários, `3` aguardando assinaturas, `4` finalizado, `5` arquivado, `6` cancelado ou `7` editando.
- Query params: `tokenAPI`, `cryptKey` quando aplicável e `pg` para a página.
- Body: nenhum.
- Paginação: até 500 documentos por página; a tool não percorre páginas automaticamente e devolve até 100 itens.
- Resposta de sucesso documentada: lista com o formato padrão de documento.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 1 minuto, por fase e página.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-todos-os-documentos-de-uma-fase> e <https://docapi.d4sign.com.br/docs/endpoints-2>.

## d4sign_templates_list

- Operação oficial: Listar templates.
- Método: `POST`, embora a operação seja somente leitura.
- Path: `/templates`.
- Path params: nenhum.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum documentado.
- Paginação: não documentada; o limite MCP é aplicado localmente.
- Resposta de sucesso documentada: templates com `id`, `name` e `variables`.
- Normalização: `variables` aceita o formato de array ou objeto indexado mostrado nas referências e vira uma lista de strings limitada.
- Repetição: não modifica estado, mas não recebe retry automático por usar `POST`.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum segundo o contrato funcional.
- Cache da aplicação: privado, 5 minutos.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/listar-templates> e <https://docapi.d4sign.com.br/docs/endpoints-2>.

## d4sign_document_attachments_list

- Operação oficial: Listar anexos vinculados a um documento principal.
- Método: `GET`.
- Path: `/documents/{uuid-main-document}/listslaves`.
- Path params: UUID exato do documento principal.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: a resposta exemplifica `current_page` e `total_pages`, mas as páginas de referência não documentam o parâmetro `pg`; nenhum parâmetro de paginação foi inventado.
- Resposta de sucesso documentada: primeiro objeto com `total_documents`, `total_in_this_page`, `current_page` e `total_pages`, seguido pelos anexos no formato de documento.
- Normalização: retorna apenas metadados dos anexos; não faz download e limita a saída a 100 itens.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 15 segundos.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/download-documentos-e-certificados-desmembrados> e <https://docapi.d4sign.com.br/docs/endpoints-2>.

## d4sign_signature_groups_list

- Operação oficial: Listar grupos de assinatura.
- Método: `GET`.
- Path: `/groups/{uuid-safe}`.
- Path params: UUID exato do cofre.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não documentada; a tool limita localmente a saída a 100 grupos.
- Resposta de sucesso documentada: array com `uuid_grupo` e `nome`.
- Normalização: UUID e nome são expostos em campos estáveis; campos desconhecidos são descartados.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 5 minutos.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/list-signature-groups> e <https://ajuda.d4sign.com.br/inserir-pin-de-rubrica-do-grupo-de-assinatura-no-documento-api>.

## d4sign_signature_group_get

- Operação oficial: Listar detalhes de grupo de assinatura.
- Método: `GET`.
- Path: `/groups/{uuid-safe}/groupdetails/{uuid-group}`.
- Path params: UUIDs exatos do cofre e do grupo.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não documentada; a tool limita localmente a saída a 100 membros.
- Resposta de sucesso documentada: `name_group` e `group_details` com conta, grupo, e-mail, tipo de assinatura, autenticações, flags, sequência e data.
- Normalização: flags `0`/`1` viram booleanos; a sequência vira inteiro; instruções de upload e datas permanecem texto limitado. Todo membro deve corresponder ao `groupUuid` solicitado.
- Restrição documentada: o token deve pertencer ao dono do grupo ou o grupo deve estar compartilhado com o cofre informado.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 1 minuto.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/retrieve-signature-group-details> e <https://ajuda.d4sign.com.br/listar-detalhes-de-grupo-de-assinatura-api>.

## d4sign_user_verify

- Operação oficial: Verificar usuário.
- Método: `POST`, embora a operação seja somente leitura.
- Path: `/users/check`.
- Path params: nenhum.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body JSON: `email_user`, obrigatório.
- Paginação: não.
- Resposta de sucesso documentada: `user` e `status`, por exemplo `unblocked`.
- Repetição: não modifica estado, mas não recebe retry automático por usar `POST`.
- Restrição documentada: o domínio do usuário deve estar validado na D4Sign.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum segundo o contrato funcional.
- Cache da aplicação: privado, 15 segundos por e-mail.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/check-user> e <https://ajuda.d4sign.com.br/verificar-usu%C3%A1rio-api>.

## d4sign_document_observers_list

- Operação oficial: Listar observadores do documento.
- Método: `GET`.
- Path: `/watcher/{uuid-document}`.
- Path params: UUID exato do documento.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não documentada; a tool limita localmente a saída a 100 observadores.
- Resposta de sucesso documentada: `uuid_arquivo` e array `watchers`, com `email` e `perfil`.
- Normalização: `watchers` vira `observers`; perfil numérico ou textual vira texto limitado.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 15 segundos.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/list-document-watchers> e <https://ajuda.d4sign.com.br/listar-observadores-do-documento-api>.

## d4sign_document_webhooks_list

- Operação oficial: Listar webhook de um documento, versão 1.0.
- Método: `GET`.
- Path: `/documents/{uuid-document}/webhooks`.
- Path params: UUID exato do documento.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Paginação: não.
- Resposta de sucesso documentada: objeto com `uuid` do documento e `webhook_url`.
- Normalização: a saída usa uma lista estável de URLs para preservar o nome plural da tool; o UUID retornado é validado e campos v2 não são expostos.
- Sensibilidade: exige `d4sign:webhooks:read`; URLs ficam somente no conteúdo estruturado e não são escritas em logs ou no resumo textual.
- Erros documentados na referência: `400`.
- Efeito colateral: nenhum.
- Idempotência: leitura.
- Cache da aplicação: privado, 15 segundos.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/list-webhook-of-a-document> e <https://docapi.d4sign.com.br/v2.0/docs/listar-webhook-de-um-documento>.

## d4sign_vault_folder_create

- Operação oficial: Criar pasta ou subpasta no cofre.
- Método: `POST`.
- Path: `/folders/{uuid-safe}/create`.
- Path params: UUID exato do cofre.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body JSON: `folder_name`, obrigatório; `uuid_folder`, opcional, identifica a pasta pai.
- Resposta de sucesso documentada: `message` e `uuid` da pasta criada.
- Normalização: retorna `success`, UUIDs do cofre/pasta/pasta pai e o nome normalizado enviado; a mensagem upstream não é refletida.
- Efeito colateral: cria uma pasta; não remove ou move conteúdo.
- Idempotência: não presumida; repetição pode criar outra pasta.
- Invalidação: cache de `vault-folders-list` da conta e tenant.
- Auditoria: principal, tenant, ação, tipo/UUID do alvo e resultado; o nome não é registrado.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/create-a-folder-or-subfolder-in-a-vault-safe> e <https://ajuda.d4sign.com.br/criar-pasta-ou-subpasta-no-cofre-api>.

## d4sign_vault_folder_rename

- Operação oficial: Renomear pasta ou subpasta no cofre.
- Método: `POST`.
- Path: `/folders/{uuid-safe}/rename`.
- Path params: UUID exato do cofre.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body JSON: `folder_name` e `uuid_folder`, ambos obrigatórios.
- Resposta de sucesso documentada: `message` de confirmação.
- Normalização: retorna `success`, UUIDs exatos e novo nome enviado; a mensagem upstream não é refletida.
- Efeito colateral: altera o nome da pasta; não move ou remove conteúdo.
- Idempotência: não declarada pela D4Sign; a tool não faz retry automático.
- Invalidação: cache de `vault-folders-list` da conta e tenant.
- Auditoria: o nome não é incluído no registro.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/rename-a-folder-or-subfolder-in-a-vault-safe> e <https://ajuda.d4sign.com.br/renomear-pasta-ou-subpasta-do-cofre-api>.

## d4sign_document_tags_add

- Operação oficial: Adicionar TAGs ao documento.
- Método: `POST`.
- Path: `/tags/{uuid-document}/add`.
- Path params: UUID exato do documento.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body JSON: `tag`, obrigatório.
- Resposta de sucesso documentada: `message` e `TAGs` com a tag adicionada.
- Normalização: uma única tag por chamada, no máximo 256 caracteres e sem vírgulas/caracteres de controle; retorna o valor de entrada validado.
- Efeito colateral: adiciona categorização ao documento; não remove tags.
- Idempotência: não presumida; não há retry automático.
- Invalidação: cache de `document-tags-list` da conta e tenant.
- Auditoria: a tag não é registrada.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/add-tags-to-document> e <https://ajuda.d4sign.com.br/adicionar-tags-no-documento-api>.

## d4sign_document_mark_urgent

- Operação oficial: Adicionar TAG URGENTE ao documento.
- Método: `POST`.
- Path: `/tags/{uuid-document}/addurgent`.
- Path params: UUID exato do documento.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body: nenhum.
- Resposta de sucesso documentada: `message` e `TAGS` com a tag urgente.
- Normalização: retorna `success`, UUID do documento e tag estável `URGENTE`.
- Restrição documentada: requer dono do cofre ou permissão Administrador/Padrão em cofre compartilhado.
- Efeito colateral: adiciona categorização urgente; não remove tags.
- Idempotência: não presumida; não há retry automático.
- Invalidação: cache de `document-tags-list` da conta e tenant.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/add-urgent-tag-to-document> e <https://ajuda.d4sign.com.br/adicionar-tag-urgente-ao-documento-api>.

## d4sign_document_observer_add

- Operação oficial: Adicionar observador ao documento.
- Método: `POST`.
- Path: `/watcher/{uuid-document}/add`.
- Path params: UUID exato do documento.
- Query params: `tokenAPI`; `cryptKey` quando aplicável.
- Body JSON: `email` e `permission`; a implementação sempre envia ambos.
- Permissões: `0` concede perfil básico com download; `1` concede somente visualização e é o padrão local de menor privilégio.
- Resposta de sucesso documentada: `message`, `uuid` do documento e `watcher` com o e-mail.
- Normalização: UUID e e-mail retornados precisam corresponder ao alvo solicitado, ignorando apenas caixa do e-mail.
- Efeito colateral: concede acesso e o observador pode receber notificações de eventos do documento.
- Idempotência: não presumida; não há retry automático.
- Invalidação: cache de `document-observers-list` da conta e tenant.
- Auditoria: o e-mail e a permissão não são registrados.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/add-watcher-to-the-document> e <https://ajuda.d4sign.com.br/adicionar-observador-no-documento-api>.

## d4sign_document_send_for_signature

- Operação oficial: Enviar documento para assinatura.
- Método/path: `POST /documents/{uuid-document}/sendtosigner`.
- Body JSON: `skip_email` e `workflow`, obrigatórios como strings `0`/`1`; `message` e `sign_limit_date` no formato `DD-MM-AA`, opcionais.
- Mapeamento MCP: `notifySigners=true` vira `skip_email=0`; `followSigningOrder=true` vira `workflow=1`.
- Pré-condição local: documento na fase 2, com um a 100 signatários.
- Efeito colateral: muda o documento para o fluxo de assinaturas e, quando habilitado, envia e-mails externos.
- Confirmação: mostra nome/UUID, fase, fluxo, notificação, prazo, mensagem e todos os signatários; usa MRTR de uso único e releitura sem cache.
- Resposta: aceita o `message` mostrado no guia ou body vazio permitido pela referência OpenAPI; retorna saída MCP estável sem refletir texto upstream.
- Idempotência: não presumida; nenhum retry automático.
- Invalidação: documento, signatários e listagens gerais/por fase/cofre.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/send-document-for-signing> e <https://ajuda.d4sign.com.br/enviar-documento-para-assinatura-api>.

## d4sign_document_cancel

- Operação oficial: Cancelar documento.
- Método/path: `POST /documents/{uuid-document}/cancel`.
- Body JSON: `comment`, opcional; sem body quando omitido.
- Pré-condição local: documento na fase 2 ou 3.
- Efeito colateral: cancelamento irreversível; o documento não pode ser reativado e deixa de aceitar assinaturas.
- Confirmação: mostra nome/UUID, fase, comentário e irreversibilidade; usa MRTR de uso único e releitura sem cache.
- Resposta de sucesso: a referência antiga mostra `message`; o guia atual mostra o documento já na fase 6. O parser aceita ambos e, no segundo formato, valida UUID e status antes de retornar somente `success` e `documentUuid`.
- Idempotência: não; nenhum retry automático.
- Invalidação: documento e listagens gerais/por fase/cofre.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/cancel-a-document> e <https://ajuda.d4sign.com.br/cancelar-um-documento-api>.

## d4sign_document_signature_link_resend

- Operação oficial: Reenviar link de assinatura.
- Método/path: `POST /documents/{uuid-document}/resend`.
- Body JSON: `email` e `key_signer`, obrigatórios.
- Pré-condição local: documento na fase 3 e uma correspondência única, ainda não assinada, entre e-mail e chave.
- Efeito colateral: envia novo e-mail externo; a D4Sign documenta intervalos crescentes entre reenvios.
- Confirmação: mostra documento e destinatário exatos; usa MRTR de uso único e releitura sem cache.
- Resposta de sucesso documentada: `message`; a saída MCP retorna os identificadores validados.
- Idempotência: não; nenhum retry automático.
- Invalidação: cache de signatários do documento.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/resend-signature-link> e <https://ajuda.d4sign.com.br/reenviar-link-de-assinatura-api>.

## d4sign_document_signer_remove

- Operação oficial: Remover signatário.
- Método/path: `POST /documents/{uuid-document}/removeemaillist`.
- Body JSON: `email-signer` e `key-signer`, obrigatórios.
- Pré-condição local: documento na fase 2 ou 3 e correspondência única, ainda não assinada, entre e-mail e chave.
- Efeito colateral: remove o vínculo de assinatura; para desfazer é necessário adicionar o signatário novamente.
- Confirmação: mostra documento e signatário exatos; usa MRTR de uso único e releitura sem cache.
- Resposta de sucesso documentada: `message`; a saída MCP retorna os identificadores validados.
- Idempotência: não; nenhum retry automático.
- Invalidação: detalhes e signatários do documento.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/remove-signer> e <https://ajuda.d4sign.com.br/remover-signat%C3%A1rio-api>.

## d4sign_user_block

- Operação oficial: Bloquear usuário.
- Método/path: `POST /users/block`.
- Body JSON: `email_user`, obrigatório.
- Pré-condição local: usuário de domínio validado, verificado por `/users/check`, com status diferente de `blocked`/`bloqueado`.
- Efeito colateral: bloqueia o acesso do usuário até eventual desbloqueio administrativo.
- Confirmação: mostra e-mail e status exatos; usa MRTR administrativo de uso único e nova verificação sem cache.
- Resposta de sucesso documentada: `message` e `success`; a saída MCP não reflete a mensagem upstream.
- Idempotência: não presumida; nenhum retry automático.
- Invalidação: cache de verificação do usuário.
- Auditoria: o e-mail não é gravado; o alvo aparece como `redacted-user`.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/block-user> e <https://ajuda.d4sign.com.br/bloquear-usu%C3%A1rio-api>.

## d4sign_batch_create

- Método/path: `POST /batches`.
- Body JSON: `keys`, array de 1 a 25 UUIDs de documentos; a tool exige valores únicos.
- Resposta: `uuid_batches` e `total`, validados contra a quantidade solicitada.
- Efeito: cria agrupamento; não envia documentos para assinatura.
- Idempotência: não declarada; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/create-a-batch> e <https://docapi.d4sign.com.br/v2.0/docs/endpoints>.

## d4sign_document_upload

- Método/path: `POST /documents/{uuid-safe}/upload`.
- Content type/body: multipart com `file`; `uuid_folder` e `workflow` opcionais. `workflow=1` segue ordem e `2` não segue.
- Entrada MCP: `uploadHandle` previamente criado por `POST /uploads`; a tool não aceita path ou URL.
- Formatos: PDF, DOC, DOCX, JPG/JPEG, PNG e BMP, validados localmente por tamanho, extensão, MIME e assinatura.
- Resposta: `uuid`; processamento e preview ocorrem em background.
- Efeito: cria documento principal; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/upload-a-main-document> e <https://docapi.d4sign.com.br/v2.0/docs/endpoints-2>.

## d4sign_document_attachment_upload

- Método/path: `POST /documents/{uuid-doc-principal}/uploadslave`.
- Content type/body: multipart com `file`.
- Entrada MCP: handle temporário vinculado ao principal/tenant.
- Resposta: `message`; processamento ocorre em background.
- Efeito: cria anexo no documento principal; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/upload-an-attachment-to-a-main-document> e <https://docapi.d4sign.com.br/v2.0/docs/endpoints-2>.

## d4sign_document_binary_upload

- Método/path: `POST /documents/{uuid-safe}/uploadbinary`.
- Body JSON: `base64_binary_file`, `mime_type`, `name` e `uuid_folder` opcional.
- Entrada MCP: base64 puro limitado; data URI é rejeitada antes da decodificação.
- Resposta: `uuid`; processamento ocorre em background.
- Efeito: cria documento principal; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/reference/upload-a-main-document-binary> e <https://docapi.d4sign.com.br/v2.0/docs/endpoints-2>.

## d4sign_document_attachment_binary_upload

- Método/path: `POST /documents/{uuid-doc-master}/uploadslavebinary`.
- Body JSON: `base64_binary_file`, `mime_type` e `name`.
- Resposta: `message`; processamento ocorre em background.
- Efeito: cria anexo; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/upload-de-um-documento-anexo-ao-principal-bin%C3%A1rio> e <https://docapi.d4sign.com.br/v2.0/docs/endpoints-2>.

## d4sign_document_download

- Método/path: `POST /documents/{uuid-document}/download`.
- Body JSON: `type` (`pdf`, `pdfa`, `zip`), `language` (`pt`, `en`), `document` e `videoselfie_frame`.
- Resposta: `url` e `name`; somente URL HTTPS sem `tokenAPI`/`cryptKey` é exposta.
- Efeito: gera link temporário; o servidor não baixa o arquivo nem registra a URL.
- Idempotência funcional: leitura sensível; sem retry por usar POST.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/download-de-um-documento> e <https://docapi.d4sign.com.br/v2.0/docs/endpoints-2>.

## d4sign_document_create_from_html_template

- Método/path: `POST /documents/{uuid-safe}/makedocumentbytemplate`.
- Body JSON: `name_document`, `templates` indexado por ID e `uuid_folder` opcional.
- Resposta: `uuid` do documento criado.
- Efeito: cria documento; não envia para assinatura; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-2>.

## d4sign_document_create_from_word_template

- Método/path: `POST /documents/{uuid-safe}/makedocumentbytemplateword`.
- Body, resposta e efeito: iguais ao fluxo HTML, usando templates Word.
- Idempotência: não; repetição pode criar novo documento.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-2>.

## d4sign_document_signers_add

- Método/path: `POST /documents/{uuid-document}/createlist`.
- Body JSON: `signers`, de 1 a 25 objetos; a camada interna converte flags e `act` para strings D4Sign.
- Campos suportados: e-mail, ação 1–13, estrangeiro/idioma, ICP-Brasil, presencial, documento/selfie, autenticação, telefones, upload, grupo, código, video-selfie, posição e supressão de e-mail.
- Validações locais: fase 2, e-mails únicos, dependências de telefone/senha e combinações de autenticação mutuamente exclusivas.
- Resposta: um objeto ou array com `key_signer`, `email` e `status`, normalizado sem devolver códigos ou documentação pessoal.
- Efeito: adiciona signatários; não envia documento para assinatura.
- Fonte oficial: <https://docapi.d4sign.com.br/reference/cadastrar-signat%C3%A1rios> e <https://docapi.d4sign.com.br/v2.0/docs/endpoints-1>.

## d4sign_document_signer_update

- Método/path: `POST /documents/{uuid-document}/changeemail`.
- Body JSON interno: `email-before`, `email-after` e `key-signer`.
- Pré-condição: correspondência única e ainda não assinada entre e-mail atual e chave; novo e-mail diferente.
- Resposta: `message`; saída MCP devolve apenas identificadores validados.
- Efeito: altera o endereço do signatário; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-1>.

## d4sign_document_signer_info_add

- Método/path: `POST /documents/{uuid-document}/addinfo`.
- Body JSON: `key_signer`, `email`, `display_name`, `documentation` e `birthday`; os três últimos são opcionais.
- Restrição oficial: destinado a assinaturas presenciais.
- Pré-condição local: signatário exato e pendente.
- Resposta: documento/e-mail/nome/status; documentação e nascimento não são refletidos na saída MCP.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-1>.

## d4sign_user_unblock

- Método/path: `POST /users/unblock`.
- Body JSON: `email_user`.
- Pré-condição: `/users/check` deve retornar o mesmo e-mail como bloqueado.
- Efeito: administrativo; MRTR e nova verificação sem cache obrigatórios.
- Resposta: mensagem/sucesso normalizados sem refletir texto upstream.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/usu%C3%A1rios>.

## d4sign_document_tags_remove

- Método/path: `POST /tags/{uuid-document}/remove`.
- Body JSON: uma única `tag` explícita, previamente relida e verificada.
- Resposta: `message` e `TAGs`.
- Efeito: remove categorização específica; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-3>.

## d4sign_document_tags_remove_all

- Método/path: `POST /tags/{uuid-document}/erase`.
- Body: nenhum.
- Efeito: remove todas as tags; MRTR mostra a lista ordenada e exige snapshot idêntico na releitura.
- Resposta: `message`; saída inclui a contagem removida.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-3>.

## d4sign_document_unmark_urgent

- Método/path: `POST /tags/{uuid-document}/removeurgent`.
- Body: nenhum.
- Resposta: `message` e `TAGs`; saída estável usa `URGENTE`.
- Restrição oficial: dono do cofre ou permissão Administrador/Padrão em cofre compartilhado.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-3>.

## d4sign_document_observer_remove

- Método/path: `POST /watcher/{uuid-document}/remove`.
- Body JSON: `email` exato.
- Pré-condição: correspondência única na releitura sem cache.
- Resposta: `message` e `watcher`, que deve corresponder ao e-mail solicitado.
- Efeito: remove acesso de um observador; sem retry automático.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-5>.

## d4sign_document_observers_remove_all

- Método/path: `POST /watcher/{uuid-document}/erase`.
- Body: nenhum.
- Efeito: remove todos os observadores; MRTR mostra os afetados e exige snapshot idêntico na releitura.
- Resposta: `message`; saída inclui a contagem removida.
- Fonte oficial: <https://docapi.d4sign.com.br/v2.0/docs/endpoints-5>.
