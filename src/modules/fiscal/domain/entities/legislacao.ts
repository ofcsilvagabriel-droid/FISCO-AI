import { z } from "zod";

export const LegislacaoSchema = z.object({
  id: z.string(),
  fonte: z.enum(["RICMS_BA", "CONV_52_91", "CONV_101_97", "CONV_142_18", "PROT_41_08", "PROT_97_10"]),
  ncm: z.string().optional(),
  cest: z.string().nullable().optional(),
  descricao: z.string().optional(),
  fundamento: z.string().optional(),
  tipo: z.string().optional(),
});
export type Legislacao = z.infer<typeof LegislacaoSchema>;
export const validarLegislacao = (i: unknown): Legislacao => LegislacaoSchema.parse(i);
