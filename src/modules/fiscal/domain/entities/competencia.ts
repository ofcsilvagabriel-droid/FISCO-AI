import { z } from "zod";

export const CompetenciaSchema = z.object({
  id: z.string(),                          // "YYYY-MM"
  ano: z.number().int(),
  mes: z.number().int().min(1).max(12),
  status: z.enum(["aberta", "fechada"]).default("aberta"),
});
export type Competencia = z.infer<typeof CompetenciaSchema>;
export const validarCompetencia = (i: unknown): Competencia => CompetenciaSchema.parse(i);

export const parseCompetencia = (yyyyMm: string): Competencia => {
  const [a, m] = yyyyMm.split("-").map(Number);
  return { id: yyyyMm, ano: a, mes: m, status: "aberta" };
};
