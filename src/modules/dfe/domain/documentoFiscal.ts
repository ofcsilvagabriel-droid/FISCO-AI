import { z } from "zod";

export const origensDocumentoFiscal = [
  "API_PROPRIA",
  "IMPORTACAO_MANUAL",
  "ACERVO_LEGADO",
] as const;

export const tiposConteudoDocumentoFiscal = ["XML_COMPLETO"] as const;

export const tiposArtefatoDocumentoFiscal = [
  "XML_ORIGINAL",
  "XML_PROCESSADO",
  "DANFE_PDF",
] as const;

export const statusProcessamentoDocumentoFiscal = [
  "pendente",
  "importada",
  "interna",
  "descartada",
  "falha",
] as const;

export const documentoFiscalSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  empresaCnpj: z.string().regex(/^[0-9]{14}$/),
  chaveAcesso: z
    .string()
    .regex(/^[0-9]{44}$/)
    .nullable(),
  origem: z.enum(origensDocumentoFiscal),
  tipoDocumento: z.literal("NFE"),
  tipoConteudo: z.enum(tiposConteudoDocumentoFiscal),
  competencia: z
    .string()
    .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/)
    .nullable(),
  dataEmissao: z.string().nullable(),
  statusProcessamento: z.enum(statusProcessamentoDocumentoFiscal),
});

export const artefatoDocumentoFiscalSchema = z.object({
  documentoId: z.string().uuid(),
  empresaCnpj: z.string().regex(/^[0-9]{14}$/),
  tipo: z.enum(tiposArtefatoDocumentoFiscal),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  storagePath: z.string().min(1),
  contentType: z.string().min(1),
  tamanhoBytes: z.number().int().nonnegative(),
});

export type OrigemDocumentoFiscal = (typeof origensDocumentoFiscal)[number];
export type TipoConteudoDocumentoFiscal = (typeof tiposConteudoDocumentoFiscal)[number];
export type TipoArtefatoDocumentoFiscal = (typeof tiposArtefatoDocumentoFiscal)[number];
export type StatusProcessamentoDocumentoFiscal =
  (typeof statusProcessamentoDocumentoFiscal)[number];
export type DocumentoFiscal = z.infer<typeof documentoFiscalSchema>;

export function competenciaDaEmissao(dataEmissao: string | null | undefined): string | null {
  const competencia = String(dataEmissao || "").slice(0, 7);
  return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(competencia) ? competencia : null;
}

export function tipoConteudoPeloSchema(schemaXml: string): TipoConteudoDocumentoFiscal {
  if (!/^procNFe/i.test(schemaXml)) throw new Error("Somente XML completo de NF-e é aceito.");
  return "XML_COMPLETO";
}
