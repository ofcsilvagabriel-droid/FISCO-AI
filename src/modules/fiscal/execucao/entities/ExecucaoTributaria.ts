// Entidade ExecucaoTributaria — amarra processo, tarefa, empresa,
// competência, produto, usuário, classificação, benefícios, cálculo,
// memória, relatório e versões dos motores em um identificador único.
import { z } from "zod";

export const StatusExecucaoSchema = z.enum([
  "EM_ANDAMENTO",
  "CONCLUIDA",
  "CONFIRMADA",
  "RECALCULADA",
  "CANCELADA",
]);
export type StatusExecucao = z.infer<typeof StatusExecucaoSchema>;

export const ExecucaoTributariaSchema = z.object({
  id: z.string(),
  criadoEm: z.string(),
  atualizadoEm: z.string(),
  status: StatusExecucaoSchema.default("EM_ANDAMENTO"),

  // vínculos
  processoId: z.string().nullable().default(null),
  tarefaId: z.string().nullable().default(null),
  empresaId: z.string().nullable().default(null),
  competencia: z.string().nullable().default(null),
  produtoId: z.string().nullable().default(null),
  usuarioId: z.string().nullable().default(null),
  notaId: z.string().nullable().default(null),

  // resultados (dados apenas — nenhuma regra aqui)
  classificacao: z.record(z.string(), z.unknown()).nullable().default(null),
  beneficios: z.array(z.record(z.string(), z.unknown())).default([]),
  calculo: z.record(z.string(), z.unknown()).nullable().default(null),
  memoria: z.array(z.record(z.string(), z.unknown())).default([]),
  score: z.number().nullable().default(null),
  confianca: z.number().nullable().default(null),
  fundamentos: z.array(z.string()).default([]),
  relatorioId: z.string().nullable().default(null),

  // reconstrutibilidade
  versoes: z.record(z.string(), z.string()).default({}),
});

export type ExecucaoTributaria = z.infer<typeof ExecucaoTributariaSchema>;
