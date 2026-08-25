# Notas e bloqueios dos contratos

## Pontos que exigem teste de sandbox

- `d4sign_vaults_list`: o guia oficial documenta `uuid-safe`, porém a API de produção respondeu `uuid_safe` em 2026-08-12. O parser aceita ambas as grafias, além de objeto único ou array, e rejeita UUIDs conflitantes quando as duas chaves aparecem juntas. O formato observado foi congelado por teste de regressão local; sandbox ainda requer homologação própria.
- `d4sign_documents_list`: o guia afirma que o primeiro bloco contém paginação, mas o exemplo principal omite esse bloco. O parser reconhece `total_documents`, `total_in_this_page`, `current_page` e `total_pages`, mantendo os totais como `null` quando ausentes.
- `d4sign_document_signers_list`: o exemplo mostra `list` como um objeto, embora a operação liste vários signatários. O parser aceita objeto ou array e deve ser validado com um documento contendo dois signatários fictícios.
- `d4sign_document_tags_list`: o trecho de paginação cita “500 usuários” e usa `/users/list`; isso aparenta ser texto copiado de outro endpoint. Nenhum `pg` foi inventado para tags.
- As páginas de referência marcam `cryptKey` como obrigatório, enquanto a especificação do projeto informa que ele depende da configuração da conta. A implementação o envia apenas quando configurado.

## Respostas fora do caminho felizes

Estes formatos eram tratados como violação de contrato e passaram a ser aceitos, porque são resultados legítimos da API:

- `d4sign_document_webhooks_list`: documento sem webhook devolve lista vazia, corpo ausente ou apenas `message`. Os três resultam em `{webhooks: [], count: 0}`. Um webhook cujo `uuid` não corresponde ao documento pedido continua sendo rejeitado.
- `d4sign_document_tags_remove` e `d4sign_document_unmark_urgent`: ao remover a última tag, a D4Sign devolve `TAGs` vazio ou omite o campo. Os parsers de remoção usam schema próprio, que exige apenas `message`; exigir `TAGs` não vazio faria o servidor reportar falha para uma mutação já concluída. Resposta sem `message` continua sendo violação.
- `d4sign_user_verify`: usuário inexistente ou fora de domínio validado devolve apenas `message`. O resultado é normalizado para `status: "not_found"`, em vez de erro `upstream_contract`.
- `d4sign_document_tags_list`: aceita objeto único também dentro de array, como as demais listagens, pela mesma razão registrada para os cofres.

Todos esses formatos permanecem **por confirmar em sandbox**: a tolerância é defensiva e não substitui homologação. Os limites de array continuam aplicados (cofres passaram a ter teto de 1.000, coerente com o schema de saída).

## Estado

Marcador: `BLOCKED_BY_SANDBOX_CREDENTIALS` somente para os testes de contrato reais. A implementação, os mocks e os testes MCP locais não dependem de credenciais externas.

## Pontos adicionais da Sprint 2

- `d4sign_vault_documents_list`: o guia documenta a variante com pasta no path, enquanto a página de referência mostra somente a variante do cofre. Ambas estão registradas no guia oficial e foram cobertas por mock.
- `d4sign_templates_list`: o exemplo descreve `variables` como “array”, mas o trecho apresentado usa chaves numéricas de objeto. O parser aceita exclusivamente array de strings ou objeto string→string; outros formatos são rejeitados até haver evidência do sandbox.
- `d4sign_document_attachments_list`: a resposta contém metadados de páginas, porém não há `pg` entre os query params oficiais. A tool expõe `totalPages`, mas não oferece um argumento sem contrato confirmado.
- Nenhuma chamada real foi feita para validar se `POST /templates` exige `{}` como body. A documentação não lista body, portanto a implementação envia POST sem body.

## Pontos adicionais da Sprint 3

- As definições OpenAPI de grupos, observadores e webhooks declaram a resposta `200` como objeto sem propriedades. Os parsers seguem os exemplos completos publicados na Central de Conhecimento oficial e rejeitam outros formatos até validação no sandbox.
- `d4sign_signature_groups_list`: o exemplo oficial retorna um array com `uuid_grupo` e `nome`; o parser também aceita um objeto único, preservando o padrão defensivo das listagens antigas da D4Sign.
- `d4sign_signature_group_get`: os membros são validados contra o `groupUuid` solicitado. Flags `0`/`1` são convertidas para booleanos e campos desconhecidos são descartados.
- `d4sign_user_verify`: exige domínio validado. A implementação envia `POST /users/check` com `email_user` no JSON e não faz retry automático por se tratar de POST.
- `d4sign_document_webhooks_list`: foi implementado o contrato v1 solicitado pelo catálogo, que retorna um objeto com `uuid` e `webhook_url`. A variante v2 para cofre/documento não foi adicionada implicitamente.
- Nenhuma chamada real dos cinco endpoints foi feita sem credenciais e fixtures isoladas de sandbox.

## Pontos adicionais da Sprint 4

- As cinco definições OpenAPI declaram respostas `200` vazias, enquanto a Central de Conhecimento fornece exemplos completos. Os parsers usam os exemplos oficiais e descartam as mensagens upstream na saída MCP.
- `d4sign_vault_folder_create`: `uuid_folder` é omitido ao criar na raiz e enviado somente para subpastas. Repetir a requisição pode criar duplicata; nenhum retry é feito.
- `d4sign_document_tags_add`: embora o título oficial use plural, o contrato recebe um único campo `tag`. A tool limita uma tag por chamada e rejeita vírgula para evitar semântica ambígua.
- `d4sign_document_mark_urgent`: a resposta oficial usa `TAGS`, enquanto a adição comum usa `TAGs`; os schemas preservam essa diferença do contrato upstream.
- `d4sign_document_observer_add`: a Central de Conhecimento chama `permission` de opcional, mas a referência OpenAPI o marca como obrigatório. A implementação sempre envia o campo e adota `1` (somente visualização) como default local.
- Não há chave de idempotência documentada para esses POSTs; nenhum recebe retry automático.
- Os testes locais usam mocks. A homologação real continua marcada como `BLOCKED_BY_SANDBOX_CREDENTIALS`.

## Pontos adicionais da Sprint 5

- `d4sign_document_send_for_signature`: a referência OpenAPI atual usa `POST /documents/{uuid}/sendtosigner`, enquanto uma página antiga do fluxo básico mostra `/sendtosing`. Foi adotado o contrato atual. O body sempre contém `skip_email` e `workflow` como strings `0`/`1`; `message` e `sign_limit_date` são opcionais.
- Para `sign_limit_date`, a referência atual descreve `DD-MM-YY`, enquanto o guia consolidado menciona `DD-MM-YYYY`. A tool segue a referência do endpoint e valida `DD-MM-AA` até homologação no sandbox.
- A referência OpenAPI do envio permite resposta `200` vazia, enquanto a Central de Conhecimento mostra `message`. Somente esse parser aceita ambos; os demais seguem as mensagens dos exemplos oficiais.
- `d4sign_document_signature_link_resend`: a Central de Conhecimento cita e-mail ou WhatsApp, mas a referência atual documenta `email` e `key_signer`. Esta sprint implementa exclusivamente o reenvio por e-mail confirmado.
- `d4sign_document_signer_remove`: os nomes oficiais do body contêm hífen (`email-signer` e `key-signer`); eles são preservados apenas na camada HTTP interna e não no schema MCP.
- `d4sign_document_cancel`: a implementação limita o cancelamento às fases 2 e 3 e informa que o documento não pode ser reativado, conforme o guia oficial.
- `d4sign_user_block`: exige usuário de domínio validado; a verificação por `/users/check` ocorre antes da confirmação e novamente, sem cache, antes do bloqueio.
- Nenhum dos POSTs sensíveis recebe retry automático. Todos os testes locais usam mocks e a homologação real permanece `BLOCKED_BY_SANDBOX_CREDENTIALS`.

## Pontos do catálogo final

- Upload principal multipart usa `workflow=1` para seguir a ordem e `workflow=2` para não seguir, conforme o guia v2 em inglês. O guia antigo em português contém uma divergência que menciona `0`; a implementação segue a documentação v2 mais recente.
- Os endpoints multipart e binários aceitam PDF, DOC, DOCX, JPG/JPEG, PNG e BMP. O limite local padrão é 10 MiB e o máximo configurável é 20 MiB; isso não implementa automaticamente o endpoint separado de big file.
- Uploads por handle são validados localmente. No perfil AWS, o storage é S3 compartilhado e o consumo falha fechado até o GuardDuty registrar `NO_THREATS_FOUND`; a disponibilidade regional e o comportamento real do scanner ainda exigem homologação na conta.
- `d4sign_document_signers_add`: exemplos oficiais enviam `act` e flags como strings. A tool recebe tipos amigáveis e a camada HTTP normaliza para strings. Combinações que a D4Sign ajustaria silenciosamente são rejeitadas localmente para evitar resultado diferente da intenção.
- `d4sign_document_signer_update`: o endpoint oficial também menciona números de WhatsApp, mas esta tool usa e-mail validado, coerente com o nome e com o modelo de signatários atual. Alteração de SMS possui endpoint separado e não pertence ao catálogo de 42.
- `d4sign_document_signer_info_add`: `birthday` não tem formato inequívoco na página oficial; por isso a tool limita o texto, mas não inventa uma máscara. A homologação deverá fixar o formato aceito.
- Criação por template usa um objeto indexado por `templateId`. IDs repetidos são rejeitados para não sobrescrever variáveis durante a transformação.
- A URL de download é aceita somente por HTTPS e rejeitada se contiver `tokenAPI` ou `cryptKey`; o host não é fixado porque a D4Sign pode usar infraestrutura/CDN temporária e o servidor não acessa a URL.
- Remoções abrangentes de tags/observadores calculam a contagem a partir da última releitura. A resposta upstream fornece apenas mensagem, portanto a contagem é uma evidência local do snapshot confirmado.
- `d4sign_document_cancel`: o parser aceita tanto a mensagem do contrato antigo quanto o objeto de documento cancelado mostrado no guia atual; o objeto precisa corresponder ao UUID e à fase 6.
- Todos os novos contratos possuem mocks de método/path/body. A validação real continua marcada como `BLOCKED_BY_SANDBOX_CREDENTIALS` para evitar mutações em dados não autorizados.
