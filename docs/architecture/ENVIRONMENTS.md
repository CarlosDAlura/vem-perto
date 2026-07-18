# Ambientes do Vem Perto

Nenhuma mudança será aplicada diretamente em produção.

| Ambiente | Banco | Vercel | Objetivo |
|---|---|---|---|
| Desenvolvimento | Supabase local/Projeto `vem-perto-dev` | ambiente local | desenvolvimento e testes automatizados |
| Homologação | Projeto Supabase separado `vem-perto-staging` | Preview da branch `staging` | validação manual e entre dispositivos |
| Produção | Projeto Supabase separado `vem-perto-production` | projeto Vercel existente, branch `main` | clientes reais |

## Regras de promoção

1. Criar backup lógico e registrar a versão da migração antes de cada etapa.
2. Aplicar migrações primeiro em desenvolvimento, depois em homologação.
3. Executar testes automatizados e o roteiro manual aprovado em homologação.
4. Criar tag de Git e plano de reversão antes de promover para produção.
5. Produção só recebe uma migração já validada e aprovada; nunca recebe experimento.

## Segredos

- `VITE_SUPABASE_ANON_KEY` pode ficar no cliente, pois é uma chave pública protegida por RLS.
- `SUPABASE_SERVICE_ROLE_KEY`, credenciais de pagamento e chaves de push ficam apenas nas variáveis seguras de Functions.
- Nenhum segredo entra no GitHub, no HTML ou no navegador.

