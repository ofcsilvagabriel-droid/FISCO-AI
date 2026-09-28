import { z } from "zod";

export const ProdutoSchema = z.object({
  id: z.string(),
  ncm: z.string().optional(),
  cest: z.string().nullable().optional(),
  descricao: z.string().optional().default(""),
  cst: z.string().nullable().optional(),
  cfop: z.string().nullable().optional(),
  orig: z.string().nullable().optional(),
  vProd: z.number().optional(),
  vICMS: z.number().optional(),
  base_icms: z.number().optional(),
  aliquota_icms: z.number().optional(),
  pmc: z.number().nullable().optional(),
  pmpf: z.number().nullable().optional(),
});

export type Produto = z.infer<typeof ProdutoSchema>;
export const validarProduto = (i: unknown): Produto => ProdutoSchema.parse(i);
