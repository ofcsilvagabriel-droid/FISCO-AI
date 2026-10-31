/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import {
  competenciaDaEmissao,
  type OrigemDocumentoFiscal,
} from "@/modules/dfe/domain/documentoFiscal";
import { criptografarXml } from "./certificadoDfe.server";

const BUCKET_DFE = "fiscoai-dfe-xml";
export const LIMITE_XML_DFE = 10 * 1024 * 1024;
const MODELO_NFE = "55";

const primeiro = (raiz: Element | Document, nome: string) =>
  raiz.getElementsByTagNameNS("*", nome).item(0);
const texto = (raiz: Element | Document, nome: string) =>
  primeiro(raiz, nome)?.textContent?.trim() || "";
const digitos = (valor: unknown) => String(valor || "").replace(/\D/g, "");
const baseCnpj = (valor: unknown) => digitos(valor).slice(0, 8);

export type DetalhesNfeEntrada = {
  chave_acesso: string;
  numero_nfe: string;
  serie_nfe: string;
  emitente_nome: string;
  emitente_cnpj: string;
  uf_origem: string;
  uf_destino: string;
  data_emissao: string;
  valor_total_xml: string | null;
};

export function validarXmlNfeCompleta(xml: Buffer, cnpjEmpresa: string): DetalhesNfeEntrada {
  if (!xml.length || xml.length > LIMITE_XML_DFE) {
    throw new Error("XML da NF-e vazio ou acima do limite permitido.");
  }
  const doc = new DOMParser().parseFromString(xml.toString("utf8"), "text/xml");
  if (!doc.documentElement || doc.documentElement.nodeName === "parsererror") {
    throw new Error("XML da NF-e é inválido.");
  }
  const nfe = primeiro(doc, "NFe");
  const infNfe = nfe && primeiro(nfe, "infNFe");
  const protocolo = primeiro(doc, "protNFe");
  const chave = infNfe?.getAttribute("Id")?.replace(/^NFe/, "") || "";
  if (
    !nfe ||
    !infNfe ||
    !primeiro(infNfe, "det") ||
    !protocolo ||
    texto(protocolo, "cStat") !== "100" ||
    !/^\d{44}$/.test(chave) ||
    texto(protocolo, "chNFe") !== chave ||
    !texto(protocolo, "nProt")
  ) {
    throw new Error("O arquivo não contém uma NF-e completa e autorizada.");
  }
  const ide = primeiro(nfe, "ide");
  const emit = primeiro(nfe, "emit");
  const dest = primeiro(nfe, "dest");
  const enderecoEmit = emit && primeiro(emit, "enderEmit");
  const enderecoDest = dest && primeiro(dest, "enderDest");
  const cnpjDestinatario = digitos(texto(dest || doc, "CNPJ"));
  const cnpjEmitente = digitos(texto(emit || doc, "CNPJ"));
  const ufEmitente = texto(enderecoEmit || emit || doc, "UF").toUpperCase();
  const ufDestinatario = texto(enderecoDest || dest || doc, "UF").toUpperCase();
  const dataEmissao = texto(ide || doc, "dhEmi") || texto(ide || doc, "dEmi");
  if (
    texto(ide || doc, "mod") !== MODELO_NFE ||
    !baseCnpj(cnpjDestinatario) ||
    baseCnpj(cnpjDestinatario) !== baseCnpj(cnpjEmpresa) ||
    cnpjEmitente === cnpjDestinatario ||
    !/^[A-Z]{2}$/.test(ufEmitente) ||
    !/^[A-Z]{2}$/.test(ufDestinatario)
  ) {
    throw new Error("A NF-e não é uma entrada modelo 55 vinculada à empresa informada.");
  }
  if (!dataEmissao || !competenciaDaEmissao(dataEmissao)) {
    throw new Error("NF-e completa sem data de emissão válida.");
  }
  return {
    chave_acesso: chave,
    numero_nfe: texto(ide || doc, "nNF"),
    serie_nfe: texto(ide || doc, "serie"),
    emitente_nome: texto(emit || doc, "xNome"),
    emitente_cnpj: cnpjEmitente,
    uf_origem: ufEmitente,
    uf_destino: ufDestinatario,
    data_emissao: dataEmissao,
    valor_total_xml: texto(primeiro(doc, "ICMSTot") || doc, "vNF") || null,
  };
}

type PersistirXmlNfeCompletaInput = {
  db: any;
  userId: string;
  cnpj: string;
  xml: Buffer;
  origem: OrigemDocumentoFiscal;
  nsu?: string | null;
  schemaXml?: string;
  metadadosOrigem?: Record<string, unknown>;
};

export async function persistirXmlNfeCompleta(input: PersistirXmlNfeCompletaInput) {
  const { db, userId, origem } = input;
  const cnpj = digitos(input.cnpj);
  if (!/^[0-9]{14}$/.test(cnpj)) throw new Error("CNPJ da empresa é inválido.");
  const detalhes = validarXmlNfeCompleta(input.xml, cnpj);
  const hash = createHash("sha256").update(input.xml).digest("hex");
  const { data: encontrados, error: buscaErro } = await db
    .from("fiscoai_dfe_documentos")
    .select("id,schema_xml,sha256,storage_path,processamento_status,origem")
    .eq("user_id", userId)
    .eq("cnpj", cnpj)
    .eq("chave_acesso", detalhes.chave_acesso)
    .order("recebido_em", { ascending: true })
    .limit(1);
  if (buscaErro) throw new Error(`Falha ao verificar duplicidade da NF-e: ${buscaErro.message}`);
  const existente = encontrados?.[0] || null;
  if (existente && /^procNFe/i.test(existente.schema_xml) && existente.sha256 === hash) {
    await registrarArtefato(db, {
      userId,
      cnpj,
      documentoId: existente.id,
      origem: existente.origem || origem,
      hash,
      path: existente.storage_path,
      tamanho: input.xml.length,
    });
    return {
      documentoId: existente.id,
      duplicado: true,
      detalhes,
      processamentoStatus: existente.processamento_status,
    };
  }

  const competencia = competenciaDaEmissao(detalhes.data_emissao);
  const pasta = competencia ? competencia.replace("-", "/") : "sem-competencia";
  const prefixo = origem.toLowerCase().replace(/_/g, "-");
  const path = `${userId}/${cnpj}/${pasta}/${prefixo}-${input.nsu || "sem-nsu"}-${hash}.enc`;
  const { error: storageErro } = await db.storage
    .from(BUCKET_DFE)
    .upload(path, criptografarXml(input.xml), {
      contentType: "application/octet-stream",
      upsert: true,
    });
  if (storageErro) throw new Error(`Falha ao guardar XML da NF-e: ${storageErro.message}`);

  const processamentoStatus = detalhes.uf_origem === detalhes.uf_destino ? "interna" : "pendente";
  const dadosDocumento = {
    user_id: userId,
    cnpj,
    nsu: input.nsu || null,
    schema_xml: input.schemaXml || "procNFe_v4.00.xsd",
    sha256: hash,
    storage_path: path,
    origem,
    tipo_documento: "NFE",
    tipo_conteudo: "XML_COMPLETO",
    competencia,
    metadados_origem: input.metadadosOrigem || {},
    atualizado_em: new Date().toISOString(),
    processamento_status: processamentoStatus,
    processamento_erro: null,
    ciencia_cstat: null,
    ciencia_motivo: null,
    ciencia_protocolo: null,
    ciencia_enviada_em: null,
    ...detalhes,
  };
  const gravacao = existente
    ? await db
        .from("fiscoai_dfe_documentos")
        .update(dadosDocumento)
        .eq("id", existente.id)
        .eq("user_id", userId)
        .select("id")
        .single()
    : await db
        .from("fiscoai_dfe_documentos")
        .upsert(dadosDocumento, { onConflict: "user_id,cnpj,chave_acesso" })
        .select("id")
        .single();
  if (gravacao.error || !gravacao.data) {
    throw new Error(
      `Falha ao indexar XML da NF-e: ${gravacao.error?.message || "documento sem identificação"}`,
    );
  }
  await registrarArtefato(db, {
    userId,
    cnpj,
    documentoId: gravacao.data.id,
    origem,
    hash,
    path,
    tamanho: input.xml.length,
  });
  return {
    documentoId: gravacao.data.id,
    duplicado: false,
    detalhes,
    processamentoStatus,
  };
}

async function registrarArtefato(
  db: any,
  dados: {
    userId: string;
    cnpj: string;
    documentoId: string;
    origem: OrigemDocumentoFiscal;
    hash: string;
    path: string;
    tamanho: number;
  },
) {
  const { error } = await db.from("fiscoai_dfe_artefatos").upsert(
    {
      user_id: dados.userId,
      cnpj: dados.cnpj,
      documento_id: dados.documentoId,
      tipo: "XML_ORIGINAL",
      origem: dados.origem,
      sha256: dados.hash,
      storage_path: dados.path,
      content_type: "application/octet-stream",
      tamanho_bytes: dados.tamanho,
      criptografia_versao: "AES-256-GCM-v1",
    },
    { onConflict: "user_id,cnpj,documento_id,tipo,sha256", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(
      `XML armazenado, mas sua cadeia de custódia não foi registrada: ${error.message}`,
    );
  }
}
