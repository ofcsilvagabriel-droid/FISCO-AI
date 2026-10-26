import { createHash, randomUUID } from "node:crypto";
import { request } from "node:https";
import { gunzipSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import { criptografarXml, descriptografarCertificado, extrairMaterialAssinatura, prepararCertificado } from "./certificadoDfe.server";
import { SignedXml } from "xml-crypto";

const ENDPOINT_DFE = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const ENDPOINT_EVENTO = "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
const BUCKET_DFE = "fiscoai-dfe-xml";
const ESPERA_SEFAZ_MS = 60 * 60 * 1000;
const LIMITE_RESPOSTA = 12 * 1024 * 1024;
const LIMITE_XML = 10 * 1024 * 1024;
const DURACAO_LOCK_MS = 10 * 60 * 1000;
const MODELO_NFE = "55";
const TIPO_EVENTO_CIENCIA = "210210";
const ORGAO_AMBIENTE_NACIONAL = "91";
const AMBIENTE_PRODUCAO = "1";
const SEQUENCIAL_CIENCIA = "1";
const SEQUENCIAL_ID_CIENCIA = "01";
const VERSAO_EVENTO_CIENCIA = "1.00";
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

function requisitarSefaz(corpo: string, tls: ReturnType<typeof prepararCertificado>["tls"], action?: string, endpoint = ENDPOINT_DFE): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const req = request(url, {
      method: "POST", ...tls, timeout: 30000,
      headers: { "Content-Type": `application/soap+xml; charset=utf-8${action ? `; action=\"${action}\"` : ""}`, "Content-Length": Buffer.byteLength(corpo) },
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

function pastaCompetenciaEmissao(dataEmissao: string | null | undefined): string {
  const correspondencia = String(dataEmissao || "").match(/^(\d{4})-(0[1-9]|1[0-2])/);
  return correspondencia ? `${correspondencia[1]}/${correspondencia[2]}` : "sem-competencia";
}

export function extrairNfeEntrada(xml: Buffer, schema: string, cnpjCertificado: string) {
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
  ) return null;
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

function extrairResumoNfe(xml: Buffer, schema: string) {
  if (!/^resNFe/i.test(schema)) return null;
  const doc = new DOMParser().parseFromString(xml.toString("utf8"), "text/xml");
  if (!doc.documentElement || doc.documentElement.nodeName === "parsererror") return null;
  const resumo = primeiro(doc, "resNFe");
  const chave = texto(resumo || doc, "chNFe");
  if (!/^\d{44}$/.test(chave) || chave.slice(20, 22) !== MODELO_NFE) return null;
  return {
    chave_acesso: chave,
    emitente_nome: texto(resumo || doc, "xNome") || null,
    emitente_cnpj: texto(resumo || doc, "CNPJ") || null,
    numero_nfe: texto(resumo || doc, "nNF") || null,
    serie_nfe: texto(resumo || doc, "serie") || null,
    data_emissao: texto(resumo || doc, "dhEmi") || texto(resumo || doc, "dEmi") || null,
    valor_total_xml: texto(resumo || doc, "vNF") || null,
  };
}

function montarEventoCiencia(chave: string, cnpj: string, privateKey: string, certificate: string) {
  const id = `ID${TIPO_EVENTO_CIENCIA}${chave}${SEQUENCIAL_ID_CIENCIA}`;
  const evento = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="${VERSAO_EVENTO_CIENCIA}"><infEvento Id="${id}"><cOrgao>${ORGAO_AMBIENTE_NACIONAL}</cOrgao><tpAmb>${AMBIENTE_PRODUCAO}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${new Date().toISOString().replace(/Z$/, "+00:00")}</dhEvento><tpEvento>${TIPO_EVENTO_CIENCIA}</tpEvento><nSeqEvento>${SEQUENCIAL_CIENCIA}</nSeqEvento><verEvento>${VERSAO_EVENTO_CIENCIA}</verEvento><detEvento versao="${VERSAO_EVENTO_CIENCIA}"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento></evento>`;
  const assinatura = new SignedXml({ privateKey, publicCert: certificate,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  assinatura.addReference({ xpath: `//*[@Id='${id}']`, transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"], digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1", uri: `#${id}` });
  assinatura.computeSignature(evento, { location: { reference: "//*[local-name()='infEvento']", action: "after" } });
  return assinatura.getSignedXml();
}

async function enviarCienciaEmissao(evento: string, tls: ReturnType<typeof prepararCertificado>["tls"]) {
  const corpo = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><nfeDadosMsg>${evento}</nfeDadosMsg></nfeRecepcaoEvento></soap:Body></soap:Envelope>`;
  const resposta = await requisitarSefaz(corpo, tls, "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento", ENDPOINT_EVENTO);
  const doc = new DOMParser().parseFromString(resposta, "text/xml");
  const retorno = primeiro(doc, "retEnvEvento") || primeiro(doc, "retEvento") || doc;
  const retEvento = primeiro(retorno, "retEvento") || retorno;
  const cStat = texto(retEvento, "cStat") || texto(retorno, "cStat");
  const motivo = texto(retEvento, "xMotivo") || texto(retorno, "xMotivo");
  const protocolo = texto(retEvento, "nProt") || null;
  if (!["135", "136", "155", "573"].includes(cStat)) throw new Error(`SEFAZ recusou a Ciência da Emissão (${cStat || "sem código"}): ${motivo || "retorno sem motivo"}`);
  return { cStat, motivo, protocolo };
}

export async function registrarCienciaResumo(db: any, userId: string, cnpj: string, documento: any) {
  if (!documento?.chave_acesso || documento.processamento_status === "ciencia_enviada") return { enviada: false };
  const { data: certificado, error } = await db.from("fiscoai_certificados_dfe")
    .select("segredo_criptografado,validade_fim").eq("user_id", userId).eq("cnpj", cnpj).single();
  if (error || !certificado || new Date(certificado.validade_fim) <= new Date()) throw new Error("Certificado A1 ausente ou vencido para registrar a Ciência da Emissão.");
  const segredo = descriptografarCertificado(certificado.segredo_criptografado);
  const { tls } = prepararCertificado(segredo.pfx, segredo.senha);
  const { privateKey, certificate } = extrairMaterialAssinatura(segredo.pfx, segredo.senha);
  const evento = montarEventoCiencia(documento.chave_acesso, cnpj, privateKey, certificate);
  const retorno = await enviarCienciaEmissao(evento, tls);
  const { error: updateError } = await db.from("fiscoai_dfe_documentos").update({
    processamento_status: "ciencia_enviada", processamento_erro: null,
    ciencia_cstat: retorno.cStat, ciencia_motivo: retorno.motivo, ciencia_protocolo: retorno.protocolo,
    ciencia_enviada_em: new Date().toISOString(),
  }).eq("id", documento.id).eq("user_id", userId);
  if (updateError) throw new Error(`Ciência registrada na SEFAZ, mas o histórico local falhou: ${updateError.message}`);
  return { enviada: true, ...retorno };
}

export async function processarCienciasPendentes(db: any, userId?: string, cnpj?: string) {
  let consulta = db.from("fiscoai_dfe_documentos").select("id,user_id,cnpj,chave_acesso,processamento_status")
    .in("processamento_status", ["ciencia_pendente", "ciencia_erro"]).not("chave_acesso", "is", null).order("recebido_em").limit(20);
  if (userId) consulta = consulta.eq("user_id", userId);
  if (cnpj) consulta = consulta.eq("cnpj", cnpj);
  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  const resultados = await Promise.allSettled((data || []).map((doc: any) => registrarCienciaResumo(db, doc.user_id, doc.cnpj, doc)));
  for (let i = 0; i < resultados.length; i++) {
    const resultado = resultados[i];
    if (resultado.status === "rejected") {
      await db.from("fiscoai_dfe_documentos").update({ processamento_status: "ciencia_erro", processamento_erro: String(resultado.reason?.message || resultado.reason).slice(0, 500) }).eq("id", data[i].id);
    }
  }
  return { enviadas: resultados.filter(r => r.status === "fulfilled").length, falhas: resultados.filter(r => r.status === "rejected").length };
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
        const resumoNfe = extrairResumoNfe(xml, item.schema);
        const detalhesNfe = extrairNfeEntrada(xml, item.schema, cnpj);
        const detalhes = detalhesNfe || resumoNfe;
        if (!detalhes) { descartados++; continue; }
        const hash = createHash("sha256").update(xml).digest("hex");
        const documento = new DOMParser().parseFromString(xml.toString("utf8"), "text/xml");
        if (!documento.documentElement || documento.documentElement.nodeName === "parsererror") throw new Error("XML inválido recebido da SEFAZ.");
        const chave = detalhesNfe ? (texto(documento, "chNFe") || primeiro(documento, "infNFe")?.getAttribute("Id")?.replace(/^NFe/, "") || null) : resumoNfe?.chave_acesso;
        const path = `${userId}/${cnpj}/${pastaCompetenciaEmissao(detalhes.data_emissao)}/${item.nsu}-${hash}.enc`;
        const { error: arquivoErro } = await db.storage.from(BUCKET_DFE).upload(path, criptografarXml(xml), {
          contentType: "application/octet-stream", upsert: true,
        });
        if (arquivoErro) throw new Error(`Falha ao guardar XML recebido: ${arquivoErro.message}`);
        const dadosRegistro = {
          user_id: userId, cnpj, nsu: item.nsu, schema_xml: item.schema,
          chave_acesso: chave, sha256: hash, storage_path: path,
          processamento_status: detalhesNfe ? (detalhesNfe.uf_origem === detalhesNfe.uf_destino ? "interna" : "pendente") : "ciencia_pendente",
          processamento_erro: null,
          ciencia_cstat: null, ciencia_motivo: null, ciencia_protocolo: null, ciencia_enviada_em: null,
          ...detalhes,
        };
        const { data: existente } = chave ? await db.from("fiscoai_dfe_documentos").select("id,storage_path")
          .eq("user_id", userId).eq("cnpj", cnpj).eq("chave_acesso", chave).maybeSingle() : { data: null };
        const grava = existente
          ? await db.from("fiscoai_dfe_documentos").update(dadosRegistro).eq("id", existente.id)
          : await db.from("fiscoai_dfe_documentos").upsert(dadosRegistro, { onConflict: "user_id,cnpj,nsu,sha256", ignoreDuplicates: true });
        const registroErro = grava.error;
        if (registroErro) throw new Error(`Falha ao indexar XML recebido: ${registroErro.message}`);
        if (existente?.storage_path && existente.storage_path !== path) await db.storage.from(BUCKET_DFE).remove([existente.storage_path]);
        novos++;
      }
    }
    const ciencias = await processarCienciasPendentes(db, userId, cnpj);
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
    return { status, cStat: retorno.cStat, recebidos: novos, descartados, ciencias, ultNsu: retorno.ultNsu || adquirido.ult_nsu,
      maxNsu: maxNsuAtualizado, bloqueadoAte: bloqueiaAte ? bloqueadoAte : null };
  } finally {
    await db.from("fiscoai_dfe_cursores").update({ lock_ate: new Date(0).toISOString(), lock_token: null })
      .eq("user_id", userId).eq("cnpj", cnpj).eq("lock_token", token);
  }
}
