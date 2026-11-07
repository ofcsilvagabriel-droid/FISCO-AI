# NFE.io em modo sombra

Esta integração permanece desativada por padrão e não está conectada ao worker de produção.

Variáveis exclusivamente do servidor:

- `NFE_IO_ENABLED=false`
- `NFE_IO_API_KEY` sem valor no repositório
- `NFE_IO_BASE_URL=https://nfe.api.nfe.io`
- `NFE_IO_TIMEOUT_MS=20000`
- `NFE_IO_CLIENT_TIMEOUT_SECONDS=20`
- `NFE_IO_MAX_CONCURRENCY=2`

O modo sombra consulta o XML V3 e devolve apenas tamanho, duração e hashes SHA-256. Ele não grava banco, storage, fila, auditoria ou o XML retornado.

Endpoints confirmados na documentação oficial em 7 de novembro de 2026:

- XML: `GET /v3/productinvoices/serpro/{chave}.xml`
- DANFE: `GET /v2/productinvoices/serpro/{chave}.pdf`
- Eventos SEFAZ: `GET /v2/productinvoices/events/{chave}`

A autenticação usa a Chave de Dados diretamente no header `Authorization`, sem prefixo `Bearer`.
