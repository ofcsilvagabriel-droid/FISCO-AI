import { z } from "zod";
import type { ID, Timestamp } from "@/core/types";

export const EmpresaSchema = z.object({
  id: z.string(),
  cnpj: z.string(),
  razaoSocial: z.string().optional().default(""),
  nomeFantasia: z.string().optional(),
  uf: z.string().optional(),
  ie: z.string().optional(),
  regime: z.enum(["SN", "LP", "LR"]).optional(),
  criadoEm: z.string().optional(),
  atualizadoEm: z.string().optional(),
});

export type Empresa = z.infer<typeof EmpresaSchema> & { id: ID; criadoEm?: Timestamp; atualizadoEm?: Timestamp };

export const validarEmpresa = (input: unknown): Empresa => EmpresaSchema.parse(input);
