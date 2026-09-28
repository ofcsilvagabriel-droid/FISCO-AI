import { z } from "zod";
import { ProdutoSchema } from "./produto";

export const NotaFiscalSchema = z.object({
  id: z.string(),
  chave: z.string().optional(),
  emit_uf: z.string().optional(),
  dest_uf: z.string().optional(),
  emit_cnpj: z.string().optional(),
  dest_cnpj: z.string().optional(),
  emit_nome: z.string().optional(),
  dest_nome: z.string().optional(),
  dhEmi: z.string().optional(),
  produtos: z.array(ProdutoSchema.partial()).default([]),
});
export type NotaFiscal = z.infer<typeof NotaFiscalSchema>;
export const validarNotaFiscal = (i: unknown): NotaFiscal => NotaFiscalSchema.parse(i);
