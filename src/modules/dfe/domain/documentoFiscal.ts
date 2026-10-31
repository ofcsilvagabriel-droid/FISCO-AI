import { z } from "zod";

export const origensDocumentoFiscal = [
  "SEFAZ_DISTRIBUICAO",
  "FISCALAPI_CHAVE",
  "IMPORTACAO_MANUAL",
] as const;

export const tiposConteudoDocumentoFiscal = ["RESUMO", "XML_COMPLETO", "EVENTO"] as const;

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
  "ciencia_pendente",
  "ciencia_enviada",
  "ciencia_erro",
] as const;

export const documentoFiscalSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  empresaCnpj: z.string().regex(/^[0-9]{14}$/),
  chaveAcesso: z
    .string()
    .regex(/^[0-9]{44}$/)
    .nullable(),
  nsu: z
    .string()
    .regex(/^[0-9]{15}$/)
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

export const solicitacaoRecuperacaoXmlSchema = z.object({
  empresaCnpj: z.string().regex(/^[0-9]{14}$/),
  chaveAcesso: z.string().regex(/^[0-9]{44}$/),
  provedor: z.literal("FISCALAPI").default("FISCALAPI"),
  manifestar: z.literal(false).default(false),
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
export type SolicitacaoRecuperacaoXml = z.infer<typeof solicitacaoRecuperacaoXmlSchema>;

export function competenciaDaEmissao(dataEmissao: string | null | undefined): string | null {
  const competencia = String(dataEmissao || "").slice(0, 7);
  return /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(competencia) ? competencia : null;
}

export function tipoConteudoPeloSchema(schemaXml: string): TipoConteudoDocumentoFiscal {
  if (/^resNFe/i.test(schemaXml)) return "RESUMO";
  if (/^procNFe/i.test(schemaXml)) return "XML_COMPLETO";
  return "EVENTO";
}
