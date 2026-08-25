# Catálogo das 42 tools

| # | Tool | Endpoint D4Sign | Scope principal | Risco/controle |
|---:|---|---|---|---|
| 1 | `d4sign_vaults_list` | `GET /safes` | `d4sign:vaults:read` | leitura |
| 2 | `d4sign_vault_documents_list` | `GET /documents/{vault}/safe[/{folder}]` | `d4sign:documents:read` | leitura paginada |
| 3 | `d4sign_vault_folders_list` | `GET /folders/{vault}/find` | `d4sign:vaults:read` | leitura |
| 4 | `d4sign_vault_folder_create` | `POST /folders/{vault}/create` | `d4sign:vaults:write` | escrita; sem retry |
| 5 | `d4sign_vault_folder_rename` | `POST /folders/{vault}/rename` | `d4sign:vaults:write` | alvo exato |
| 6 | `d4sign_batch_create` | `POST /batches` | `d4sign:documents:write` | 1–25 UUIDs únicos |
| 7 | `d4sign_documents_list` | `GET /documents` | `d4sign:documents:read` | leitura paginada |
| 8 | `d4sign_document_get` | `GET /documents/{uuid}` | `d4sign:documents:read` | leitura |
| 9 | `d4sign_documents_list_by_phase` | `GET /documents/{phase}/status` | `d4sign:documents:read` | leitura paginada |
| 10 | `d4sign_document_upload` | `POST /documents/{vault}/upload` | `d4sign:documents:write` | multipart por handle |
| 11 | `d4sign_document_attachment_upload` | `POST /documents/{uuid}/uploadslave` | `d4sign:documents:write` | multipart por handle |
| 12 | `d4sign_document_binary_upload` | `POST /documents/{vault}/uploadbinary` | `d4sign:documents:write` | base64 limitado |
| 13 | `d4sign_document_attachment_binary_upload` | `POST /documents/{uuid}/uploadslavebinary` | `d4sign:documents:write` | base64 limitado |
| 14 | `d4sign_document_send_for_signature` | `POST /documents/{uuid}/sendtosigner` | `d4sign:documents:send` | efeito externo; MRTR |
| 15 | `d4sign_document_cancel` | `POST /documents/{uuid}/cancel` | `d4sign:documents:cancel` | irreversível; MRTR |
| 16 | `d4sign_document_download` | `POST /documents/{uuid}/download` | `d4sign:documents:download` | URL temporária sensível |
| 17 | `d4sign_document_signature_link_resend` | `POST /documents/{uuid}/resend` | `d4sign:documents:send` | e-mail externo; MRTR |
| 18 | `d4sign_templates_list` | `POST /templates` | `d4sign:documents:read` | leitura por POST |
| 19 | `d4sign_document_create_from_html_template` | `POST /documents/{vault}/makedocumentbytemplate` | `d4sign:documents:write` | criação explícita |
| 20 | `d4sign_document_create_from_word_template` | `POST /documents/{vault}/makedocumentbytemplateword` | `d4sign:documents:write` | criação explícita |
| 21 | `d4sign_document_attachments_list` | `GET /documents/{uuid}/listslaves` | `d4sign:documents:read` | metadados apenas |
| 22 | `d4sign_document_signers_list` | `GET /documents/{uuid}/list` | `d4sign:signers:read` | dados pessoais mínimos |
| 23 | `d4sign_signature_groups_list` | `GET /groups/{vault}` | `d4sign:signers:read` | leitura |
| 24 | `d4sign_signature_group_get` | `GET /groups/{vault}/groupdetails/{group}` | `d4sign:signers:read` | dados pessoais mínimos |
| 25 | `d4sign_document_signers_add` | `POST /documents/{uuid}/createlist` | `d4sign:signers:write` | fase 2; 1–25 alvos |
| 26 | `d4sign_document_signer_update` | `POST /documents/{uuid}/changeemail` | `d4sign:signers:write` | chave/e-mail exatos |
| 27 | `d4sign_document_signer_remove` | `POST /documents/{uuid}/removeemaillist` | `d4sign:signers:write` | destrutiva; MRTR |
| 28 | `d4sign_document_signer_info_add` | `POST /documents/{uuid}/addinfo` | `d4sign:signers:write` | PII; alvo exato |
| 29 | `d4sign_user_verify` | `POST /users/check` | `d4sign:users:read` | leitura por POST |
| 30 | `d4sign_user_block` | `POST /users/block` | `d4sign:users:admin` | administrativa; MRTR |
| 31 | `d4sign_user_unblock` | `POST /users/unblock` | `d4sign:users:admin` | administrativa; MRTR |
| 32 | `d4sign_document_tags_list` | `GET /tags/{uuid}` | `d4sign:tags:read` | leitura |
| 33 | `d4sign_document_tags_add` | `POST /tags/{uuid}/add` | `d4sign:tags:write` | uma tag explícita |
| 34 | `d4sign_document_tags_remove` | `POST /tags/{uuid}/remove` | `d4sign:tags:write` | alvo explícito |
| 35 | `d4sign_document_tags_remove_all` | `POST /tags/{uuid}/erase` | `d4sign:tags:write` | abrangente; MRTR |
| 36 | `d4sign_document_mark_urgent` | `POST /tags/{uuid}/addurgent` | `d4sign:tags:write` | escrita |
| 37 | `d4sign_document_unmark_urgent` | `POST /tags/{uuid}/removeurgent` | `d4sign:tags:write` | remoção específica |
| 38 | `d4sign_document_observers_list` | `GET /watcher/{uuid}` | `d4sign:observers:read` | dados pessoais mínimos |
| 39 | `d4sign_document_observer_add` | `POST /watcher/{uuid}/add` | `d4sign:observers:write` | concede acesso |
| 40 | `d4sign_document_observer_remove` | `POST /watcher/{uuid}/remove` | `d4sign:observers:write` | e-mail exato |
| 41 | `d4sign_document_observers_remove_all` | `POST /watcher/{uuid}/erase` | `d4sign:observers:write` | abrangente; MRTR |
| 42 | `d4sign_document_webhooks_list` | `GET /documents/{uuid}/webhooks` | `d4sign:webhooks:read` | URL sensível |

Todos os inputs são objetos estritos. Credenciais não aparecem em schemas. UUIDs destrutivos nunca são inferidos por nome; quando desconhecidos, o cliente deve usar primeiro uma tool de listagem. Nenhum POST recebe retry automático.

As oito operações MRTR apresentam alvo/consequência, vinculam a confirmação a argumentos e principal/tenant, impedem replay no processo e relêem o estado relevante antes da mutação.
