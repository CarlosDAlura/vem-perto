# Etapa 2 — Clientes reais do Supabase

## Escopo de desenvolvimento

As quatro interfaces passaram a usar `vem-perto-supabase.js`. O adaptador usa a chave publicável do projeto de desenvolvimento, Supabase Auth, Data API protegida por RLS, RPCs transacionais e Realtime. Não existe `service_role` no navegador, no Git ou no HTML.

## Dados substituídos

- Sessão, cadastro e login: Supabase Auth e `profiles`.
- Cliente: catálogo, endereço, favoritos, cupons, pontos, pedidos, avaliações, chat e notificações.
- Lojista: cadastro de loja, documentos privados, produtos, status operacional, pedidos e financeiro.
- Motoboy: cadastro, documentos privados, online/offline, ofertas de entrega, entregas e ganhos.
- Administrador: aprovações, usuários, pedidos, financeiro, cupons, avisos, categorias e auditoria.

O `vem-perto-core.js` foi mantido no repositório como código legado, mas não é mais carregado pelas quatro interfaces da Etapa 2. Não há gravação manual de dados da aplicação em `localStorage` nessas telas; o armazenamento local que permanecer no navegador é apenas o mecanismo interno de sessão do Supabase Auth.

## Migrações adicionais

1. `20260718000500_stage_02_app_rpcs.sql`: favoritos, aplicações, documentos privados, cardápio, operação, chat, ofertas de entrega e ações administrativas.
2. `20260718000600_fix_approval_status_rpcs.sql`: correção tipada das funções de aprovação identificada no teste integrado.

## Ambiente

Esta branch usa exclusivamente o projeto `vemperto-dev`. Antes de qualquer promoção, a configuração pública deve apontar para o projeto de homologação e os testes manuais devem ser repetidos. A produção e seus domínios não recebem esta branch.
