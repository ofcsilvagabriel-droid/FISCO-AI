# FiscoAI — API local para agente

O FiscoAI Desktop agora inicia uma API local exclusiva para automação por agente. Ela escuta somente em `127.0.0.1` e não fica exposta para a rede.

## Arquivos de configuração

Depois de abrir o FiscoAI, são criados:

- `%APPDATA%\FiscoAI\agent-token.txt`
- `%APPDATA%\FiscoAI\agent-config.json`

O `agent-config.json` informa a porta escolhida automaticamente e o caminho do token.

## Endpoints

`GET /agent/health`

Não exige token. Serve para verificar se a API está ativa.

`GET /agent/info`

Exige `X-FiscoAI-Agent-Token`.

`POST /agent/xmls/scan`

Exemplo de corpo:

```json
{
  "folder": "D:\\Empresas\\Empresa A\\XML",
  "recursive": true,
  "limit": 10000
}
```

`POST /agent/xmls/import`

Localiza todos os XMLs da pasta e usa o mesmo fluxo de importação em lote do FiscoAI.

`GET /agent/archive`

Retorna o Arquivo Fiscal atualmente persistido no FiscoAI.

`POST /agent/report/pdf`

Gera o mesmo PDF consolidado usado pela tela Arquivo Fiscal e grava diretamente em uma pasta do Windows.

Exemplo:

```json
{
  "empresaKey": "12345678000100",
  "competencia": "2026-08",
  "outputDir": "D:\\Empresas\\Empresa A\\Relatorios"
}
```

`POST /agent/run`

Ação de alto nível disponível atualmente:

```json
{
  "action": "import_and_report",
  "folder": "D:\\Empresas\\Empresa A\\XML",
  "outputDir": "D:\\Empresas\\Empresa A\\Relatorios",
  "competencia": "2026-08",
  "recursive": true
}
```

Essa ação localiza os XMLs, importa pelo motor existente, lê o Arquivo Fiscal e gera um PDF por empresa/competência encontrada.

## Autenticação

Envie o token no cabeçalho:

```text
X-FiscoAI-Agent-Token: <conteúdo de %APPDATA%\\FiscoAI\\agent-token.txt>
```

## Observação importante

A API não substitui nem duplica o motor fiscal. Ela chama a lógica já existente no FiscoAI. A etapa de apuração consolidada usa os registros efetivamente gravados no Arquivo Fiscal pelo fluxo de importação.
