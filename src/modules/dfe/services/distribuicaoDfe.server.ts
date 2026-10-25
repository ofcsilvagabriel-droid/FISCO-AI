import { createHash, randomUUID } from "node:crypto";
import { request } from "node:https";
import { gunzipSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { criptografarXml, descriptografarCertificado, prepararCertificado } from "./certificadoDfe.server";

const ENDPOINT_DFE = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const BUCKET_DFE = "fiscoai-dfe-xml";
const ESPERA_SEFAZ_MS = 60 * 60 * 1000;
const LIMITE_RESPOSTA = 12 * 1024 * 1024;
const LIMITE_XML = 10 * 1024 * 1024;
const DURACAO_LOCK_MS = 10 * 60 * 1000;
const MODELO_NFE = "55";
const MAX_DOCUMENTOS_LOTE = 50;

const primeiro = (raiz: Element | Document, nome: string) => raiz.getElementsByTagNameNS("*", nome).item(0);
const texto = (raiz: Element | Document, nome: string) => primeiro(raiz, nome)?.textContent?.trim() || "";

export function montarConsultaDfe(cnpj: string, ultNsu: string): string {
  if (!/^[0-9]{14}$/.test(cnpj) || !/^[0-9]{15}$/.test(ultNsu)) throw new Error("CNPJ ou NSU inválido.");
  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>1</tpAmb><CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${ultNsu}</ultNSU></distNSU>` +
    `</distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap:Body></soap:Envelope>`;
}

function requisitarSefaz(corpo: string, tls: ReturnType<typeof prepararCertificado>["tls"]): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT_DFE);
    const req = request(url, {
      method: "POST", ...tls, timeout: 30000,
      headers: { "Content-Type": "application/soap+xml; charset=utf-8", "Content-Length": Buffer.byteLength(corpo) },
    }, res => {
      const partes: Buffer[] = [];
      let tamanho = 0;
      res.on("data", (parte: Buffer) => {
        tamanho += parte.length;
        if (tamanho > LIMITE_RESPOSTA) { req.destroy(new Error("Resposta da SEFAZ excede o limite permitido.")); return; }
        partes.push(parte);
      });
      res.on("end", () => {
        if ((res.statusCode || 0) >= 400) { reject(new Error(`SEFAZ respondeu HTTP ${res.statusCode}.`)); return; }
        resolve(Buffer.concat(partes).toString("utf8"));
      });
    });
    req.on("timeout", () => req.destroy(new Error("Tempo de resposta da SEFAZ excedido.")));
    req.on("error", reject);
    req.end(corpo);
  });
}

export function interpretarRetornoDfe(resposta: string) {
  const doc = new DOMParser().parseFromString(resposta, "text/xml");
  const retorno = primeiro(doc, "retDistDFeInt");
  if (!retorno) throw new Error("Resposta da SEFAZ não contém retorno de distribuição válido.");
  const cStat = texto(retorno, "cStat");
  const ultNsu = texto(retorno, "ultNSU");
  const maxNsu = texto(retorno, "maxNSU");
  const documentos = Array.from(retorno.getElementsByTagNameNS("*", "docZip")).map(no => ({
    nsu: no.getAttribute("NSU") || "", schema: no.getAttribute("schema") || "", base64: no.textContent?.trim() || "",
  }));
  if (documentos.length > MAX_DOCUMENTOS_LOTE) throw new Error("Lote da SEFAZ maior que o permitido.");
  return { cStat, motivo: texto(retorno, "xMotivo"), ultNsu, maxNsu, documentos };
}

function baseCnpj(valor: string): string {
  return String(valor || "").replace(/\D/g, "").slice(0, 8);
}

export function extrairEntradaInterestadual(xml: Buffer, schema: string, cnpjCertificado: string) {
  if (!/^procNFe/i.test(schema)) return null;
  const doc = new DOMParser().parseFromString(xml.toString("utf8"), "text/xml");
  if (!doc.documentElement || doc.documentElement.nodeName === "parsererror") return null;
  const nfe = primeiro(doc, "NFe");
  if (!nfe) return null;
  const ide = primeiro(nfe, "ide");
  const emit = primeiro(nfe, "emit");
  const dest = primeiro(nfe, "dest");
  const enderecoEmit = emit && primeiro(emit, "enderEmit");
  const enderecoDest = dest && primeiro(dest, "enderDest");
  const cnpjDestinatario = texto(dest || doc, "CNPJ");
  const cnpjEmitente = texto(emit || doc, "CNPJ");
  const ufEmitente = texto(enderecoEmit || emit || doc, "UF").toUpperCase();
  const ufDestinatario = texto(enderecoDest || dest || doc, "UF").toUpperCase();
  if (texto(ide || doc, "mod") !== MODELO_NFE
    || !baseCnpj(cnpjDestinatario)
    || baseCnpj(cnpjDestinatario) !== baseCnpj(cnpjCertificado)
    || cnpjEmitente === cnpjDestinatario
    || !/^[A-Z]{2}$/.test(ufEmitente)
    || !/^[A-Z]{2}$/.test(ufDestinatario)
    || ufEmitente === ufDestinatario) return null;
  return {
    numero_nfe: texto(ide || doc, "nNF"),
    serie_nfe: texto(ide || doc, "serie"),
    emitente_nome: texto(emit || doc, "xNome"),
    emitente_cnpj: cnpjEmitente,
    uf_origem: ufEmitente,
    uf_destino: ufDestinatario,
    data_emissao: texto(ide || doc, "dhEmi") || texto(ide || doc, "dEmi"),
    valor_total_xml: texto(primeiro(doc, "ICMSTot") || doc, "vNF") || null,
  };
}

export async function consultarDistribuicaoDfe(db: any, userId: string, cnpj: string) {
  const { data: certificado, error: certErro } = await db.from("fiscoai_certificados_dfe")
    .select("segredo_criptografado,validade_fim").eq("user_id", userId).eq("cnpj", cnpj).single();
  if (certErro || !certificado) throw new Error("Certificado deste CNPJ não encontrado.");
  if (new Date(certificado.validade_fim) <= new Date()) throw new Error("Certificado vencido. Cadastre um novo A1.");

  const { data: cursor, error: cursorErro } = await db.from("fiscoai_dfe_cursores").select("*")
    .eq("user_id", userId).eq("cnpj", cnpj).single();
  if (cursorErro || !cursor) throw new Error("Cursor de distribuição não encontrado.");
  const agora = new Date();
  if (new Date(cursor.bloqueado_ate) > agora) throw new Error(`Aguarde até ${new Date(cursor.bloqueado_ate).toLocaleString("pt-BR")}: intervalo exigido pela SEFAZ.`);

  const token = randomUUID();
  const { data: adquirido, error: lockErro } = await db.from("fiscoai_dfe_cursores")
    .update({ lock_ate: new Date(agora.getTime() + DURACAO_LOCK_MS).toISOString(), lock_token: token })
    .eq("user_id", userId).eq("cnpj", cnpj).lt("lock_ate", agora.toISOString())
    .lt("bloqueado_ate", agora.toISOString()).select("ult_nsu").maybeSingle();
  if (lockErro) throw new Error(lockErro.message);
  if (!adquirido) throw new Error("Consulta já em andamento ou temporariamente bloqueada para este CNPJ.");

  try {
    const segredo = descriptografarCertificado(certificado.segredo_criptografado);
    const { tls } = prepararCertificado(segredo.pfx, segredo.senha);
    const resposta = await requisitarSefaz(montarConsultaDfe(cnpj, adquirido.ult_nsu), tls);
    const retorno = interpretarRetornoDfe(resposta);
    const status = `${retorno.cStat} — ${retorno.motivo}`.slice(0, 250);
    if (!["137", "138", "656"].includes(retorno.cStat)) {
      await db.from("fiscoai_dfe_cursores").update({ ultimo_status: status,
        bloqueado_ate: new Date(Date.now() + (retorno.cStat === "656" ? ESPERA_SEFAZ_MS : 15 * 60 * 1000)).toISOString(), consultado_em: new Date().toISOString(),
      }).eq("user_id", userId).eq("cnpj", cnpj).eq("lock_token", token);
      throw new Error(`SEFAZ: ${status}`);
    }
    let novos = 0;
    let descartados = 0;
    if (retorno.cStat === "138") {
      for (const item of retorno.documentos) {
        if (!/^[0-9]{15}$/.test(item.nsu) || !item.base64 || !item.schema) throw new Error("Documento DF-e inválido no lote.");
        const xml = gunzipSync(Buffer.from(item.base64, "base64"), { maxOutputLength: LIMITE_XML });
        const detalhesNfe = extrairEntradaInterestadual(xml, item.schema, cnpj);
        if (!detalhesNfe) { descartados++; continue; }
        const hash = createHash("sha256").update(xml).digest("hex");
        const documento = new DOMParser().parseFromString(xml.toString("utf8"), "text/xml");
        if (!documento.documentElement || documento.documentElement.nodeName === "parsererror") throw new Error("XML inválido recebido da SEFAZ.");
        const chave = texto(documento, "chNFe") || primeiro(documento, "infNFe")?.getAttribute("Id")?.replace(/^NFe/, "") || null;
        const path = `${userId}/${cnpj}/${item.nsu}-${hash}.enc`;
        const { error: arquivoErro } = await db.storage.from(BUCKET_DFE).upload(path, criptografarXml(xml), {
          contentType: "application/octet-stream", upsert: true,
        });
        if (arquivoErro) throw new Error(`Falha ao guardar XML recebido: ${arquivoErro.message}`);
        const { error: registroErro } = await db.from("fiscoai_dfe_documentos").upsert({
          user_id: userId, cnpj, nsu: item.nsu, schema_xml: item.schema,
          chave_acesso: chave, sha256: hash, storage_path: path, processamento_status: "pendente", processamento_erro: null,
          ...detalhesNfe,
        }, { onConflict: "user_id,cnpj,nsu,sha256", ignoreDuplicates: true });
        if (registroErro) throw new Error(`Falha ao indexar XML recebido: ${registroErro.message}`);
        novos++;
      }
    }
    const NSUAtualizado = retorno.ultNsu || adquirido.ult_nsu;
    const maxNsuAtualizado = retorno.maxNsu || cursor.max_nsu;
    const bloqueiaAte = ["137", "656"].includes(retorno.cStat)
      || (retorno.cStat === "138" && NSUAtualizado === maxNsuAtualizado);
    const bloqueadoAte = bloqueiaAte
      ? new Date(Date.now() + ESPERA_SEFAZ_MS).toISOString() : new Date(0).toISOString();
    const { error: gravacaoErro } = await db.from("fiscoai_dfe_cursores").update({
      ult_nsu: NSUAtualizado, max_nsu: maxNsuAtualizado,
      ultimo_status: status, consultado_em: new Date().toISOString(), bloqueado_ate: bloqueadoAte,
    }).eq("user_id", userId).eq("cnpj", cnpj).eq("lock_token", token);
    if (gravacaoErro) throw new Error(gravacaoErro.message);
    return { status, cStat: retorno.cStat, recebidos: novos, descartados, ultNsu: retorno.ultNsu || adquirido.ult_nsu,
      maxNsu: maxNsuAtualizado, bloqueadoAte: bloqueiaAte ? bloqueadoAte : null };
  } finally {
    await db.from("fiscoai_dfe_cursores").update({ lock_ate: new Date(0).toISOString(), lock_token: null })
      .eq("user_id", userId).eq("cnpj", cnpj).eq("lock_token", token);
  }
}
