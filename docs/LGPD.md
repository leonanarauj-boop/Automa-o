# LGPD — riscos, controles e responsabilidades

> Documento técnico de apoio. Não substitui avaliação jurídica.

## Papéis
- **Cliente da plataforma (empresa)**: *controlador* dos dados dos seus contatos.
- **Retoma**: *operador*; trata dados conforme instruções do controlador (formalizar em DPA).
- Dados de usuários da plataforma (nome, e-mail): Retoma é controladora.

## Dados tratados hoje
Nome, telefone/WhatsApp, e-mail, empresa, mensagens trocadas, notas internas, negócios e valores, registros de consentimento, logs de auditoria.

**Atenção para clínicas:** conversas podem conter dados de saúde (dados sensíveis, art. 11). O sistema não é prontuário e não deve ser usado como tal. Recomendar aos clientes não registrar diagnósticos em notas.

## Controles já implementados
- Isolamento rigoroso por empresa (RLS testado).
- Registro de consentimento **append-only** com origem e evidência; descadastro automático por palavra-chave bloqueia templates.
- Minimização: o sistema só guarda o que chega pelo canal ou é digitado pela equipe.
- Dados de demonstração identificados (`is_demo`) e removíveis.
- Dados de uma empresa nunca são usados para outra: o contexto enviado à IA é lido com RLS da própria organização (testado).
- Copiloto de IA: trechos da conversa, dados do contato e a base de conhecimento da empresa são enviados ao provedor de IA (Anthropic) **somente quando um usuário aciona** a sugestão ou a análise. O registro interno (`ai_calls`) guarda apenas metadados. A organização pode desativar a IA.
- Auditoria de ações sensíveis.

- Campanhas exigem consentimento de marketing registrado (com evidência) e respeitam descadastramento e frequência máxima; automações respeitam descadastramento e exigem consentimento para templates de marketing.

## Pendências
- Listar a Anthropic como suboperadora na Política de Privacidade e no DPA; avaliar transferência internacional de dados (art. 33) e as configurações de retenção do provedor.
- Exportação e exclusão de dados do titular a pedido (tabela `data_requests` prevista no modelo-alvo).
- Política de retenção configurável (mensagens, eventos brutos de webhook — hoje sem expurgo automático; meta: 30 dias para `webhook_events`).
- Termos de Uso, Política de Privacidade, DPA e RIPD; nomeação de encarregado (DPO).
- Criptografia de campos sensíveis por segmento.
