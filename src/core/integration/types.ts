// ============================================================
// INTEGRATION CORE — Contratos públicos
// ------------------------------------------------------------
// Camada declarativa. Nenhum módulo importa outro módulo
// diretamente: toda comunicação passa por estes contratos.
// ============================================================
import { z } from "zod";

/** Catálogo de eventos da plataforma. Novos eventos entram aqui. */
export const TIPOS_EVENTO = [
  "CLASSIFICACAO_CONCLUIDA",
  "BENEFICIO_IDENTIFICADO",
  "BENEFICIO_REMOVIDO",
  "CALCULO_EXECUTADO",
  "CALCULO_RECALCULADO",
  "CALCULO_CONFIRMADO",
  "MEMORIA_GERADA",
  "RELATORIO_PUBLICADO",
  "PROCESSO_CONCLUIDO",
  "PROCESSO_REABERTO",
  "TAREFA_CONCLUIDA",
  "BASE_IMPORTADA",
  "LEGISLACAO_ATUALIZADA",
  "USUARIO_ALTEROU_CLASSIFICACAO",
  "UPLOAD_REALIZADO",
  "PARAMETRO_ALTERADO",
  "EXCLUSAO_REALIZADA",
  "INDICADORES_ATUALIZADOS",
  "EXECUCAO_TRIBUTARIA_REGISTRADA",
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];

/** Módulos registrados no barramento (origem/destino dos eventos). */
export type ModuloPlataforma =
  | "MOTOR_TRIBUTARIO"
  | "MOTOR_BENEFICIOS"
  | "MOTOR_CALCULO"
  | "EXECUCAO_TRIBUTARIA"
  | "RASTREABILIDADE"
  | "RELATORIOS"
  | "DASHBOARD"
  | "INDICADORES"
  | "GESTAO_PROCESSOS"
  | "INTEGRACOES"
  | "IA"
  | "UI";

export type StatusEvento = "PENDENTE" | "PROCESSANDO" | "PROCESSADO" | "FALHA" | "DESCARTADO";

export const EventoContextoSchema = z.object({
  usuarioId: z.string().nullable().default(null),
  empresaId: z.string().nullable().default(null),
  competencia: z.string().nullable().default(null),
  processoId: z.string().nullable().default(null),
  tarefaId: z.string().nullable().default(null),
  execucaoId: z.string().nullable().default(null),
  produtoId: z.string().nullable().default(null),
});
export type EventoContexto = z.infer<typeof EventoContextoSchema>;

export const DomainEventSchema = z.object({
  id: z.string(),
  tipo: z.enum(TIPOS_EVENTO),
  origem: z.string(),
  destino: z.array(z.string()).default([]),
  data: z.string(),
  versaoContrato: z.string().default("1.0"),
  contexto: EventoContextoSchema,
  /** Referência ao objeto relacionado (tipo + id). */
  objeto: z.object({ tipo: z.string(), id: z.string().nullable().default(null) }),
  payload: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["PENDENTE", "PROCESSANDO", "PROCESSADO", "FALHA", "DESCARTADO"]).default("PENDENTE"),
  tentativas: z.number().default(0),
  erro: z.string().nullable().default(null),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

/** Entrada mínima para publicar um evento (o core completa o resto). */
export interface EventoInput {
  tipo: TipoEvento;
  origem: ModuloPlataforma | string;
  destino?: Array<ModuloPlataforma | string>;
  objeto?: { tipo: string; id?: string | null };
  contexto?: Partial<EventoContexto>;
  payload?: Record<string, unknown>;
}

export type EventHandler = (evento: DomainEvent) => void | Promise<void>;

export interface EventSubscription {
  readonly nome: string;
  readonly tipos: TipoEvento[] | "*";
  handle: EventHandler;
}

/** Contrato de um módulo plugado no Integration Core. */
export interface ModuleContract {
  readonly nome: ModuloPlataforma | string;
  readonly versao: string;
  readonly assinaturas?: EventSubscription[];
  /** Capacidades expostas a outros módulos (chamadas via IntegrationCore). */
  readonly capacidades?: Record<string, (...args: never[]) => unknown>;
}

/** Conector externo (sistema de gestão, contábil, CRM, API pública…). */
export interface ExternalConnector {
  readonly nome: string;
  readonly versaoApi: string;
  aceita(evento: DomainEvent): boolean;
  enviar(evento: DomainEvent): Promise<void>;
}
