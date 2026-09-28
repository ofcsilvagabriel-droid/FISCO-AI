# FiscoAI Desktop — execução no Windows

## 1. Instalar dependências
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
npm install
```

## 2. Testar a versão desktop
```powershell
npm run desktop:dev
```

O comando faz o build, confirma que o servidor Nitro para Node foi gerado e abre o Electron. A porta local é escolhida automaticamente a partir da 4173.

## 3. Gerar instalador
```powershell
npm run desktop:dist
```

O instalador fica em `dist/`.
