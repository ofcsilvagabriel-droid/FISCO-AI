# Distribuição DF-e no FiscoAI

Fonte: Portal Nacional da NF-e, serviço `NFeDistribuicaoDFe` (produção). Revisão: 25/10/2026; Nota Técnica 2014.002 v1.40 publicada em 03/07/2026. Antes de alterar o protocolo, conferir a versão vigente no Portal Nacional.

## Ativação

1. Aplicar `supabase/migrations/20261026000000_dfe_distribuicao.sql` no projeto Supabase correto.
2. Configurar no servidor da Vercel `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `FISCOAI_CERTIFICATE_ENCRYPTION_KEY` (32 bytes aleatórios codificados em base64). Manter `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` para o login no navegador. Nunca criar uma variável `VITE_` para a chave de serviço ou a de criptografia.
3. Não alterar a chave de criptografia depois do primeiro certificado cadastrado sem um plano de rotação: os certificados e XMLs anteriores se tornariam ilegíveis. Nesta instalação, há um backup da chave protegido pela conta Windows em `%APPDATA%\FiscoAI\certificate-key.dpapi`; sua recuperação depende dessa conta/perfil.
4. Fazer deploy e entrar no FiscoAI. Na aba **Buscar XMLs / Certificados**, cadastrar A1 PFX/P12, senha e CNPJ autorizado. O certificado deve ser da empresa interessada ou autorizado a acessar seus XMLs.
5. Consultar manualmente um lote. O cursor é individual por usuário e CNPJ; se outra aplicação consultar o mesmo CNPJ, coordenar o `ultNSU` para não provocar rejeição 656.

## Fluxo e controles

- A1 e senha são cifrados com AES-256-GCM no servidor. Nem a chave de cifragem nem o PFX são expostos por API de leitura ao navegador. A tabela e o bucket privado não concedem acesso direto a `anon`/`authenticated`; as funções validam o usuário e filtram por `user_id`.
- PFX legado que o OpenSSL da Vercel não abre é convertido somente em memória para certificado/chave PEM antes do mTLS. O fallback usa `node-forge@1.4.0` sob a opção BSD-3-Clause; não usa a verificação de assinatura RSA do pacote (afetada por GHSA-86w9-cpqp-85rv). Reavaliar a dependência quando houver versão corrigida.
- A consulta usa mTLS e `distNSU`. O retorno `docZip` é descompactado com limite de tamanho, recebe SHA-256, é cifrado e gravado no bucket privado; metadados ficam no banco. O cursor só avança após persistir todos os documentos do lote.
- `resNFe` é resumo, não nota completa. Apenas XMLs completos (`procNFe`) oferecem botão de importação no FiscoAI. Nenhuma manifestação é automática.
- Após `cStat=137` ou `656`, o CNPJ aguarda pelo menos uma hora. Outros status exigem investigação antes de novas tentativas; a aplicação aplica pausa de 15 minutos.
- A interface mostra certificados vencidos ou com até 60 dias restantes. Não há e-mail/SMS de alerta quando o app está fechado.

## Verificações antes de produção

- Testar com A1 próprio e CNPJ autorizado, em ambiente adequado; confirmar certificado, comunicação mTLS, `137`, `138`, `656`, resumo, XML completo e integridade do arquivo.
- Testar dois usuários e dois CNPJs: um usuário nunca deve listar, baixar ou usar o certificado do outro.
- Testar repetição do mesmo NSU, lotes com mais de uma NF-e e mistura de regimes tributários após importação. Conferir que Arquivo Fiscal e Histórico não duplicam registros.
- Verificar na Vercel o tempo limite de execução da função e no Supabase a disponibilidade do bucket privado. Não armazenar PFX, senha ou XML nos logs.

## Recuperação

- Se houver `656`, aguardar uma hora completa sem novas chamadas; insistir reinicia o bloqueio.
- Se ocorrer falha após salvar parte do lote, manter o cursor anterior e repetir somente depois de resolver a falha: os caminhos e hashes permitem deduplicação.
- Se aparecer lacuna de NSU, não zerar automaticamente o cursor; investigar a sequência do ator e consultas feitas por outros sistemas.
- Na troca de A1 do mesmo CNPJ, o cursor é preservado. Ao excluir o certificado, os XMLs já recebidos permanecem no bucket privado; o cursor é removido junto com o certificado.
