$ErrorActionPreference = 'Stop'

Write-Host '=== FiscoAI Desktop - Build Windows ===' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js não foi encontrado. Instale Node.js 22 LTS ou superior.'
}

Write-Host "Node: $(node --version)" -ForegroundColor DarkGray
Write-Host 'Instalando dependências...' -ForegroundColor Yellow
npm install

Write-Host 'Gerando instalador do FiscoAI...' -ForegroundColor Yellow
npm run desktop:dist

Write-Host ''
Write-Host 'Concluído. Confira a pasta dist/.' -ForegroundColor Green
