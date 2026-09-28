import { z } from "zod";

export const BeneficioSchema = z.object({
  id: z.string(),
  tipo: z.enum(["ISENCAO", "REDUCAO_BC", "CREDITO_PRESUMIDO", "DIFERIMENTO"]),
  fonte: z.string(),
  ncm: z.string().optional(),
  descricao: z.string().optional(),
  cargaEfetiva: z.number().optional(),
  fundamento: z.string().optional(),
});
export type Beneficio = z.infer<typeof BeneficioSchema>;
export const validarBeneficio = (i: unknown): Beneficio => BeneficioSchema.parse(i);
