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
- Dados de uma empresa nunca são usados para outra (não há treinamento de modelos; a IA ainda não foi implementada e, quando for, usará apenas a base da própria empresa).
- Auditoria de ações sensíveis.

## Pendências
- Exportação e exclusão de dados do titular a pedido (tabela `data_requests` prevista no modelo-alvo).
- Política de retenção configurável (mensagens, eventos brutos de webhook — hoje sem expurgo automático; meta: 30 dias para `webhook_events`).
- Termos de Uso, Política de Privacidade, DPA e RIPD; nomeação de encarregado (DPO).
- Criptografia de campos sensíveis por segmento.
