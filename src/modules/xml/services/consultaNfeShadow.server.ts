import { createHash } from "node:crypto";
import { provedorNfeIo } from "@/modules/xml/providers/nfeIo.server";
import type { ProvedorNfe } from "@/modules/xml/providers/types";

export type ResultadoConsultaSombra = {
  chave: string;
  provedor: "NFE_IO";
  oficial: boolean;
  duracaoMs: number;
  tamanhoBytes: number;
  hashSha256: string;
  hashReferencia?: string;
  igualReferencia?: boolean;
};

/**
 * Consulta de diagnóstico da Fase 2. Não grava banco, storage, fila ou auditoria
 * e não devolve o XML bruto ao chamador.
 */
export async function executarConsultaSombraNfeIo(
  entrada: { chave: string; xmlReferencia?: Buffer },
  provedor: ProvedorNfe = provedorNfeIo,
): Promise<ResultadoConsultaSombra> {
  const resultado = await provedor.consultarXml(entrada.chave);
  if (!resultado.xml) throw new Error("A consulta sombra não recebeu XML da NFE.io.");
  const hashSha256 = createHash("sha256").update(resultado.xml).digest("hex");
  const hashReferencia = entrada.xmlReferencia
    ? createHash("sha256").update(entrada.xmlReferencia).digest("hex")
    : undefined;
  return {
    chave: entrada.chave,
    provedor: "NFE_IO",
    oficial: resultado.oficial,
    duracaoMs: resultado.duracaoMs,
    tamanhoBytes: resultado.xml.length,
    hashSha256,
    ...(hashReferencia ? { hashReferencia, igualReferencia: hashReferencia === hashSha256 } : {}),
  };
}
