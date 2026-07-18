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

