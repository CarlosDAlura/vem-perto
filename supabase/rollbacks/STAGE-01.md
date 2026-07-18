# Reversão da etapa 1

As migrações da etapa 1 são aditivas e ainda não foram aplicadas a nenhum ambiente remoto.

## Desenvolvimento e homologação

Antes de qualquer dado real, o rollback é feito restaurando o snapshot do banco/branch de desenvolvimento e revertendo o commit correspondente. Não execute `DROP ... CASCADE` como procedimento automático.

## Produção

Depois de haver dados reais, a reversão deve ser uma nova migração de correção ou uma restauração do backup lógico criado antes da promoção. Nunca se deve remover tabelas de produção para desfazer esta etapa.

## Checklist antes de aplicar uma migração

1. Registrar ID do backup do banco e a tag Git atual.
2. Executar em desenvolvimento e validar o arquivo `scripts/verify-supabase-schema.mjs`.
3. Executar os testes de isolamento RLS e concorrência em homologação.
4. Só então autorizar a promoção.

