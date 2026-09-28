import { z } from "zod";

export const ClienteSchema = z.object({
  id: z.string(),
  cnpjCpf: z.string(),
  nome: z.string().optional().default(""),
  uf: z.string().optional(),
  ie: z.string().optional(),
});
export type Cliente = z.infer<typeof ClienteSchema>;
export const validarCliente = (i: unknown): Cliente => ClienteSchema.parse(i);
