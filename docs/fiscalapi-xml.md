# FiscalAPI — recuperação de XML por chave

Revisão: 31/10/2026.

## Uso no FiscoAI

- Fonte alternativa: FiscalAPI, `POST https://api.fiscalapi.com.br/api/consultar-nfe-xml`.
- Uso exclusivo: recuperar uma NF-e modelo 55 quando a chave de 44 dígitos já é conhecida.
- A Distribuição DF-e da SEFAZ continua sendo a fonte principal e responsável por descobrir documentos.
- A chamada é unitária e explícita. Não existe varredura automática de chaves nem repetição automática que consuma créditos.
- A chave da FiscalAPI fica apenas no servidor em `FISCALAPI_API_KEY`; nunca usar prefixo `VITE_`.

## Segurança e cadeia de custódia

- O certificado A1 e sua senha são descriptografados somente no servidor e enviados por HTTPS para a consulta.
- O corpo sempre contém `manifestar: false`. O contrato e o banco também rejeitam `true`.
- Uma resposta com `manifestacao` diferente de `null` é tratada como falha de segurança.
- Antes de armazenar, o FiscoAI confere chave, modelo 55, protocolo de autorização, participante, tamanho e estrutura do `nfeProc`.
- O XML validado recebe SHA-256, criptografia AES-256-GCM e registro de proveniência. Logs não contêm XML, certificado, senha ou chave da API.

## Operação e custos

- A documentação informa uma chave por requisição e cobrança somente quando há XML.
- Nos planos Lite, Starter e Pro, um XML retornado consome três consultas; condições comerciais podem mudar.
- Não há retry automático. Nova tentativa depende de ação explícita e é bloqueada enquanto outra estiver em andamento.
- Status sem XML são preservados: somente resumo, não autorizado, não encontrado, fora do prazo, chave inválida, cancelada ou erro.

## Privacidade e termos

- O cliente é controlador dos dados consultados e deve possuir base legal e autorização para usar o certificado.
- Embora a FiscalAPI declare zero custódia para certificado e senha na consulta unitária, sua política informa armazenamento cifrado do XML consultado e de metadados para histórico e novo download.
- Os termos proíbem revenda ou redistribuição dos dados como base própria ou produto concorrente.
- Antes da produção, o responsável deve aceitar os termos vigentes, contratar um plano com API por chave e cadastrar a chave no ambiente da Vercel.

Fontes oficiais verificadas em 31/10/2026:

- https://docs.fiscalapi.com.br/docs/nfe/consultar-nfe-chave
- https://fiscalapi.com.br/termos/
- https://fiscalapi.com.br/privacidade/
- https://fiscalapi.com.br/precos/
