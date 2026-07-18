# Responsabilidades de backend

## Supabase Data API

Uso permitido apenas para leituras protegidas por RLS: catálogo público aprovado, produtos disponíveis, pedidos do participante, notificações próprias e endereços próprios. Endereços podem ser incluídos/alterados pelo próprio usuário sob policy RLS.

## Supabase Edge Functions

Chamadas de negócio autenticadas: criação de pedido, cupom, transição de status, atribuição de motoboy, atualização de preço/cardápio, solicitação/aprovação de loja ou motoboy, avaliações, geração de URL temporária de documento e notificações.

As Edge Functions encaminham o JWT do usuário para as funções PostgreSQL. As funções no banco fazem as validações e transações, portanto não confiam em preço, taxa, status ou identidade enviados pelo navegador.

## Vercel Functions

Ficam reservadas para integrações externas: webhooks de pagamento, tarefas agendadas, envio por provedores de push/e-mail e verificações que precisem de segredo de terceiro. Elas não substituirão o Supabase como fonte de dados.

## Chaves

O navegador recebe somente URL do projeto e chave pública `anon`. Service role, tokens de pagamento e credenciais de provedores ficam exclusivamente nos segredos das Functions, configurados por ambiente.

