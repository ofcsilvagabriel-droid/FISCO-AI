# Plataforma Profissional — Padronização de Dados e Camadas

Objetivo: estabelecer entidades tipadas, camadas transversais (API/Logger/Cache/Errors/Config/Constants) e o fluxo obrigatório **Tela → Service → Repository → API**, sem alterar layout, comportamento ou regras fiscais.

## Estrutura alvo

```text
src/
  core/
    config/          config.ts (client), config.server.ts (já existe)
    constants/       fiscal.ts, app.ts, http.ts
    errors/          AppError, DomainError, ValidationError, NotFoundError,
                     IntegrationError + handler central (mantém error-capture)
    logger/          logger.ts (console estruturado + níveis)
    cache/           memoryCache.ts (TTL, namespaces)
    api/             httpClient.ts (fetch wrapper: retry, timeout, erros)
    types/           shared (Result<T,E>, Paginated<T>, ID, etc.)
  modules/
    fiscal/domain/
      entities/      empresa.ts, produto.ts, fornecedor.ts, cliente.ts,
                     notaFiscal.ts, usuario.ts, competencia.ts, apuracao.ts,
                     relatorio.ts, legislacao.ts, beneficio.ts
                     (cada um: interface + type + zod validator)
      repositories/  EmpresaRepository, ProdutoRepository, FornecedorRepository,
                     ClienteRepository, NotaFiscalRepository, UsuarioRepository,
                     CompetenciaRepository, ApuracaoRepository,
                     RelatorioRepository, LegislacaoRepository,
                     BeneficioRepository
                     (persistência local: localStorage/memória via cache)
      services/      EmpresaService, ProdutoService, ... (um por entidade)
                     + os já existentes (Calculo/Classificacao/Legislacao/Arquivo)
    danfe/           mover fetch direto para core/api/httpClient
```

## Lotes (pequenos, com validação entre cada)

**Lote 1 — Camadas transversais (core)**
- `core/constants/` (fiscal.ts com UFs, thresholds; http.ts; app.ts).
- `core/logger/logger.ts` (níveis debug/info/warn/error, sink console).
- `core/errors/` (`AppError` base + subclasses; helper `handleError`).
- `core/cache/memoryCache.ts` (Map + TTL, namespace).
- `core/api/httpClient.ts` (fetch wrapper com timeout/retry/erros normalizados).
- `core/types/` (Result, Paginated, ID, Timestamp).
- Validar: build + testes.

**Lote 2 — Entidades**
- Uma interface + type + zod validator por entidade, em `modules/fiscal/domain/entities/`.
- Reaproveitar `entities/types.ts` atual (ProdutoNF, NotaFiscal, Regra) sem quebrar imports.
- Validar: build + testes.

**Lote 3 — Repositories**
- Um repository por entidade. As entidades fiscais oficiais (Legislação, Benefício) já têm repos — só padronizar interface (getAll/findById/query).
- Entidades de estado da app (Empresa, NotaFiscal, Apuração…) → repository sobre `localStorage` com serialização validada pelo zod schema.
- Validar: build + testes.

**Lote 4 — Services por entidade**
- Um service por entidade, exposto no barril `domain/services`.
- Services chamam Repositories; Engines fiscais continuam sendo consumidos pelos services fiscais existentes.
- Validar: build + testes.

**Lote 5 — Integração DANFE via httpClient**
- `meudanfe.functions.ts` passa a usar `core/api/httpClient` + `IntegrationError`.
- Validar: build + testes.

**Lote 6 — Fluxo Tela → Service**
- Onde `FiscoAI.jsx` hoje toca `localStorage` diretamente (Arquivo Fiscal, empresas), passar por hook `useFiscoAI` → services novos.
- Não alterar JSX nem handlers de UI; só a origem dos dados.
- Validar: build + testes + smoke da UI.

## Garantias
- Motores fiscais atuais permanecem intactos; entidades e repositories são infraestrutura sobre eles.
- Layout, comportamento e regras fiscais preservados.
- Cada lote termina com build verde e 17 testes passando.

## Fora de escopo
- Backend/DB remoto (persistência continua local).
- Alteração de UI, cálculo, MVA, thresholds, redução de base.
- Quebra do `FiscoAI.jsx` em subcomponentes.

## Confirmação
1. OK persistência local (localStorage) para entidades de estado (Empresa, NotaFiscal, Apuração), sem introduzir backend?
2. Executar todos os 6 lotes em sequência sem pausa, ou pausar para validar preview entre cada lote?
