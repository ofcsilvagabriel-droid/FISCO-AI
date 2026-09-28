import { z } from "zod";

export const TIPOS_DECISAO_MEMORIA = [
  "ST_MANUAL",
  "ANTECIPACAO_MANUAL",
  "DIFAL_MANUAL",
  "ISENTO",
  "NAO_TRIBUTADO",
  "PRESUNCAO_CREDITO",
] as const;

export const ParametrosMemoriaSchema = z
  .object({
    mva_utilizada: z.number().nullable().optional(),
    mva_informada: z.number().nullable().optional(),
    mva_ja_ajustada: z.boolean().optional(),
    icms_presuntivo_aliquota: z.number().nullable().optional(),
    modo_calculo: z.string().nullable().optional(),
  })
  .passthrough();

export const MemoriaCalculoSchema = z.object({
  id: z.string(),
  empresa_id: z.string().nullable().optional(),
  ncm: z.string(),
  descricao: z.string().nullable().optional(),
  tipo_decisao: z.enum(TIPOS_DECISAO_MEMORIA),
  parametros: ParametrosMemoriaSchema.default({}),
  fundamento: z.string().default(""),
  criado_em: z.string(),
  atualizado_em: z.string(),
  ativo: z.boolean().default(true),
});

export type TipoDecisaoMemoria = (typeof TIPOS_DECISAO_MEMORIA)[number];
export type MemoriaCalculoPorNCM = z.infer<typeof MemoriaCalculoSchema>;
export const validarMemoriaCalculo = (i: unknown): MemoriaCalculoPorNCM =>
  MemoriaCalculoSchema.parse(i);
