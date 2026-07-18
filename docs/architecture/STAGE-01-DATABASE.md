# Etapa 1 — Base de dados versionada

## Backup registrado

Foi criado um snapshot local anterior à etapa em `work/backups/stage-01-pre-supabase`.

## Objetivo

Adicionar somente a infraestrutura versionada de banco: schema, RLS, buckets privados, funções transacionais e roteiros de rollback. Esta etapa não conecta o frontend, não remove o `localStorage` e não altera a Vercel.

## Ordem de aplicação

1. `20260718000100_foundation.sql`
2. `20260718000200_rls_policies.sql`
3. `20260718000300_order_transactions.sql`
4. `20260718000400_realtime.sql`

## Validação em desenvolvimento

O ambiente de desenvolvimento recebeu as quatro migrations, duas buckets privadas para documentos e dados de teste dos quatro perfis. O roteiro `supabase/tests/001_central_order_flow.sql` percorre o pedido central, a atribuição de motoboy, a entrega e a avaliação dentro de uma transação encerrada com `ROLLBACK`; ele não deixa pedidos, cupons resgatados ou avaliações de teste persistidos.

## Critério de conclusão

As migrações devem ser aplicadas e testadas em desenvolvimento antes da criação dos projetos de homologação e produção. A próxima etapa só começa após a validação das policies.
# Etapa 1 — Base de dados versionada

## Backup registrado

Foi criado um snapshot local anterior à etapa em `work/backups/stage-01-pre-supabase`.

## Objetivo

Adicionar somente a infraestrutura versionada de banco: schema, RLS, buckets privados, funções transacionais e roteiros de rollback. Esta etapa não conecta o frontend, não remove o `localStorage` e não altera a Vercel.

## Ordem de aplicação

1. `20260718000100_foundation.sql`
2. `20260718000200_rls_policies.sql`
3. `20260718000300_order_transactions.sql`

## Critério de conclusão

As migrações devem ser aplicadas e testadas em desenvolvimento antes da criação dos projetos de homologação e produção. A próxima etapa só começa após a validação das policies.

