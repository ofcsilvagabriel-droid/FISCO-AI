// ============================================================
// INTERFACES DE IA — apenas contratos. Nenhuma implementação.
// A IA acessa a plataforma por estas portas, sem depender do
// front-end nem importar módulos diretamente.
// ============================================================
import type { DomainEvent } from "@/core/integration";

export interface EscopoConsultaIA {
  empresaId?: string | null;
  competencia?: string | null;
  produtoId?: string | null;
  execucaoId?: string | null;
  processoId?: string | null;
  usuarioId?: string | null;
  limite?: number;
}

/** Fonte de leitura exposta à IA (implementada por cada módulo). */
export interface AIReadProvider<T = unknown> {
  readonly nome:
    | "CONTEXTO_TRIBUTARIO"
    | "MEMORIA_CALCULO"
    | "CLASSIFICACAO"
    | "BENEFICIOS"
    | "HISTORICO"
    | "RASTREABILIDADE"
    | "EVENTOS";
  consultar(escopo: EscopoConsultaIA): Promise<T[]> | T[];
}

/** Dossiê consolidado entregue à IA. */
export interface DossieIA {
  escopo: EscopoConsultaIA;
  geradoEm: string;
  versoes: Record<string, string>;
  contextoTributario: unknown[];
  classificacao: unknown[];
  beneficios: unknown[];
  memoria: unknown[];
  historico: unknown[];
  rastreabilidade: unknown[];
  eventos: DomainEvent[];
}

/** Porta de execução de um futuro agente de IA. */
export interface AIAgentPort {
  readonly nome: string;
  readonly versao: string;
  executar(dossie: DossieIA, instrucao: string): Promise<{ resposta: string; referencias: string[] }>;
}
