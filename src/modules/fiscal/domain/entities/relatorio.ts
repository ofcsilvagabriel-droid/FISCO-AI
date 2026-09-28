import { z } from "zod";

export const RelatorioSchema = z.object({
  id: z.string(),
  tipo: z.enum(["ICMS", "ST", "DIFAL", "FCP", "GERAL"]),
  empresaId: z.string().optional(),
  competencia: z.string().optional(),
  geradoEm: z.string(),
  payload: z.unknown().optional(),
});
export type Relatorio = z.infer<typeof RelatorioSchema>;
export const validarRelatorio = (i: unknown): Relatorio => RelatorioSchema.parse(i);
