// Entidade de Rastreabilidade Tributária — registro de negócio,
// nunca de infraestrutura. Substitui a auditoria técnica anterior.
import { z } from "zod";

export const ACOES_RASTREAVEIS = [
  "PRODUTO_CLASSIFICADO",
  "PRODUTO_RECLASSIFICADO",
  "BENEFICIO_IDENTIFICADO",
  "BENEFICIO_REMOVIDO",
  "CALCULO_EXECUTADO",
  "CALCULO_RECALCULADO",
  "CALCULO_CONFIRMADO",
  "LEGISLACAO_APLICADA",
  "UPLOAD_REALIZADO",
  "BASE_ALTERADA",
  "PARAMETRO_ALTERADO",
  "EXCLUSAO",
  "IMPORTACAO",
  "PROCESSO_CONCLUIDO",
  "RELATORIO_PUBLICADO",
] as const;

export type AcaoRastreavel = (typeof ACOES_RASTREAVEIS)[number];

export const TrilhaEventoSchema = z.object({
  id: z.string(),
  acao: z.enum(ACOES_RASTREAVEIS),
  descricao: z.string(),
  fundamento: z.string().nullable().default(null),
  data: z.string(),
  eventoId: z.string().nullable().default(null),
  contexto: z.object({
    usuarioId: z.string().nullable().default(null),
    empresaId: z.string().nullable().default(null),
    competencia: z.string().nullable().default(null),
    processoId: z.string().nullable().default(null),
    execucaoId: z.string().nullable().default(null),
    produtoId: z.string().nullable().default(null),
    motor: z.string().nullable().default(null),
    legislacao: z.string().nullable().default(null),
    relatorioId: z.string().nullable().default(null),
  }),
  detalhes: z.record(z.string(), z.unknown()).default({}),
});

export type TrilhaEvento = z.infer<typeof TrilhaEventoSchema>;
export type ContextoTrilha = TrilhaEvento["contexto"];
