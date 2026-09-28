import { z } from "zod";

export const FornecedorSchema = z.object({
  id: z.string(),
  cnpj: z.string(),
  razaoSocial: z.string().optional().default(""),
  uf: z.string().optional(),
  ie: z.string().optional(),
});
export type Fornecedor = z.infer<typeof FornecedorSchema>;
export const validarFornecedor = (i: unknown): Fornecedor => FornecedorSchema.parse(i);
