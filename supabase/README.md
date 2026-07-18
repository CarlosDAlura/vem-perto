# Supabase do Vem Perto

As migrações são somente aditivas e devem ser aplicadas por ambiente, na ordem do nome do arquivo. Não use a service role no frontend.

Operações sensíveis entram por Edge Functions que chamam as funções transacionais do banco com o JWT do usuário. A Data API é reservada para leituras autorizadas e alterações simples do próprio perfil/endereço.

