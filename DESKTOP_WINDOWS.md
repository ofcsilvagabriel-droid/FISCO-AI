# FiscoAI Desktop — versão local para Windows

Esta versão envolve a aplicação TanStack Start atual em um shell Electron. A interface e o servidor Nitro continuam sendo os mesmos; o Electron cria a janela própria do Windows e inicializa o servidor local em `127.0.0.1`.

## Pré-requisitos

- Windows 10/11 64-bit
- Node.js 22 LTS ou superior
- conexão com a internet na primeira instalação para baixar dependências

## Gerar o instalador

```bash
npm install
npm run desktop:dist
```

O instalador `.exe` será criado em `dist/`.

## Gerar somente a versão portátil

```bash
npm install
npm run desktop:dist:portable
```

## Testar como aplicativo

```bash
npm install
npm run desktop:dev
```

## Arquitetura

O app desktop inicia o servidor produzido pelo TanStack Start/Nitro e abre uma janela Electron em `http://127.0.0.1:4173`. Isso preserva SSR, rotas, middleware e integrações existentes, evitando uma reescrita prematura da aplicação.

## Próxima fase recomendada

Depois de a versão desktop abrir corretamente, a próxima etapa é separar o que deve funcionar 100% localmente (banco, arquivos importados, configurações, cache e backups) do que pode continuar sincronizado com o Supabase.
