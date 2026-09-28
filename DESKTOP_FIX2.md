# FiscoAI Desktop — FIX 2

Esta versão corrige a inicialização do servidor local no aplicativo empacotado.

Correções principais:
- o servidor Nitro agora é localizado usando `app.getAppPath()`, que funciona quando o `.output` está dentro do `app.asar`;
- o processo filho do Electron empacotado é iniciado em `ELECTRON_RUN_AS_NODE=1`, permitindo executar `index.mjs` como Node;
- o diretório de trabalho do servidor usa a pasta real de `resources`, evitando `cwd` dentro do ASAR.

## Comandos no Windows

Após extrair:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
npm install
npm run desktop:dev
```

Depois que a janela abrir e fechar normalmente:

```powershell
Ctrl + C
npm run desktop:dist
```

O instalador ficará em `dist\\FiscoAI-Desktop-1.0.0-x64.exe`.


## Correção de escala e proporção
- Electron agora declara suporte a HiDPI sem forçar escala física.
- A janela inicial é dimensionada de acordo com a área útil do monitor.
- Zoom interno é travado em 100% para evitar deformações por Ctrl +/- .
- Layout responsivo reduz a sidebar e reconfigura a navegação em janelas estreitas.
- A aplicação evita ultrapassar a área útil do monitor ao ser redimensionada.
