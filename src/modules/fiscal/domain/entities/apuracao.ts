import { z } from "zod";

export const ApuracaoSchema = z.object({
  id: z.string(),
  empresaId: z.string(),
  competencia: z.string(), // YYYY-MM
  totalICMS: z.number().default(0),
  totalST: z.number().default(0),
  totalDIFAL: z.number().default(0),
  totalFCP: z.number().default(0),
  atualizadoEm: z.string().optional(),
});
export type Apuracao = z.infer<typeof ApuracaoSchema>;
export const validarApuracao = (i: unknown): Apuracao => ApuracaoSchema.parse(i);
