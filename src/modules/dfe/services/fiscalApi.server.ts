/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { descriptografarCertificado, descriptografarXml } from "./certificadoDfe.server";
import { persistirXmlNfeCompleta, validarXmlNfeCompleta } from "./documentoFiscal.server";

const ENDPOINT_FISCALAPI = "https://api.fiscalapi.com.br/api/consultar-nfe-xml";
const BUCKET_DFE = "fiscoai-dfe-xml";
const LIMITE_RESPOSTA_FISCALAPI = 12 * 1024 * 1024;
const TIMEOUT_FISCALAPI_MS = 45_000;

const respostaFiscalApiSchema = z.object({
  request_id: z.string().min(1),
  total: z.number().int(),
  com_dado: z.number().int(),
  creditos_cobrados: z.number().int().nonnegative(),
  resultados: z
    .array(
      z.object({
        chave: z.string().regex(/^[0-9]{44}$/),
        status: z.enum([
          "ok",
          "somente_resumo",
          "nao_autorizado",
          "nao_encontrado",
          "fora_prazo",
          "chave_invalida",
          "cancelada",
          "erro",
        ]),
        cstat: z.string().nullable().optional(),
        mensagem: z.string().nullable().optional(),
        from_cache: z.boolean().optional().default(false),
        manifestacao: z.string().nullable().optional(),
        xml: z.string().nullable().optional(),
      }),
    )
    .length(1),
});

type RespostaFiscalApi = z.infer<typeof respostaFiscalApiSchema>;

async function lerRespostaLimitada(resposta: Response): Promise<string> {
  if (!resposta.body) return "";
  const leitor = resposta.body.getReader();
  const partes: Buffer[] = [];
  let tamanho = 0;
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    tamanho += value.byteLength;
    if (tamanho > LIMITE_RESPOSTA_FISCALAPI) {
      await leitor.cancel();
      throw new Error("Resposta da FiscalAPI excede o limite permitido.");
    }
    partes.push(Buffer.from(value));
  }
  return Buffer.concat(partes).toString("utf8");
}

export async function consultarFiscalApiPorChave(
  entrada: { apiKey: string; chave: string; certificado: string; senha: string },
  fetchImpl: typeof fetch = fetch,
): Promise<RespostaFiscalApi> {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_FISCALAPI_MS);
  try {
    const resposta = await fetchImpl(ENDPOINT_FISCALAPI, {
      method: "POST",
      headers: { "X-API-Key": entrada.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        chave: entrada.chave,
        certificado: entrada.certificado,
        senha: entrada.senha,
        manifestar: false,
      }),
      signal: controlador.signal,
    });
    const tamanhoDeclarado = Number(resposta.headers.get("content-length") || 0);
    if (tamanhoDeclarado > LIMITE_RESPOSTA_FISCALAPI)
      throw new Error("Resposta da FiscalAPI excede o limite permitido.");
    const texto = await lerRespostaLimitada(resposta);
    if (!resposta.ok) throw new Error(`FiscalAPI respondeu HTTP ${resposta.status}.`);
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error("FiscalAPI retornou uma resposta inválida.");
    }
    return respostaFiscalApiSchema.parse(json);
  } catch (erro) {
    if (erro instanceof Error && erro.name === "AbortError")
      throw new Error("Tempo de resposta da FiscalAPI excedido.");
    throw erro;
  } finally {
    clearTimeout(timeout);
  }
}

export function validarXmlFiscalApi(xmlTexto: string, chave: string, cnpj: string) {
  const xml = Buffer.from(xmlTexto, "utf8");
  const detalhes = validarXmlNfeCompleta(xml, cnpj);
  if (detalhes.chave_acesso !== chave)
    throw new Error("A chave do XML retornado não corresponde à chave solicitada.");
  return { xml, detalhes };
}

function statusRecuperacao(status: RespostaFiscalApi["resultados"][number]["status"]) {
  return (
    (
      {
        somente_resumo: "SOMENTE_RESUMO",
        nao_autorizado: "NAO_AUTORIZADA",
        nao_encontrado: "NAO_ENCONTRADA",
        fora_prazo: "FORA_PRAZO",
        chave_invalida: "CHAVE_INVALIDA",
        cancelada: "CANCELADA",
        erro: "FALHA",
      } as const
    )[status as Exclude<typeof status, "ok">] || "FALHA"
  );
}

async function registrarTentativa(db: any, dados: Record<string, unknown>) {
  const { error } = await db.from("fiscoai_dfe_tentativas").insert(dados);
  if (error) console.warn(`[FISCALAPI_AUDITORIA] Falha ao registrar tentativa: ${error.message}`);
}

async function atualizarRecuperacao(
  db: any,
  userId: string,
  cnpj: string,
  chave: string,
  dados: Record<string, unknown>,
) {
  const { error } = await db
    .from("fiscoai_dfe_recuperacoes")
    .update({
      ...dados,
      lock_ate: new Date(0).toISOString(),
      lock_token: null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("cnpj", cnpj)
    .eq("chave_acesso", chave);
  if (error) throw new Error(`Não foi possível atualizar a recuperação do XML: ${error.message}`);
}

export async function recuperarXmlFiscalApi(db: any, userId: string, cnpj: string, chave: string) {
  const apiKey = process.env.FISCALAPI_API_KEY;
  if (!apiKey) throw new Error("FISCALAPI_API_KEY não está configurada no servidor.");

  const { data: existentes, error: existenteErro } = await db
    .from("fiscoai_dfe_documentos")
    .select("id,schema_xml,sha256,storage_path,processamento_status")
    .eq("user_id", userId)
    .eq("cnpj", cnpj)
    .eq("chave_acesso", chave)
    .order("recebido_em", { ascending: true })
    .limit(1);
  if (existenteErro) throw new Error(existenteErro.message);
  const existente = existentes?.[0] || null;
  if (existente && /^procNFe/i.test(existente.schema_xml)) {
    const { data: arquivo } = await db.storage.from(BUCKET_DFE).download(existente.storage_path);
    if (arquivo) {
      try {
        const xmlExistente = descriptografarXml(Buffer.from(await arquivo.arrayBuffer()));
        if (createHash("sha256").update(xmlExistente).digest("hex") === existente.sha256) {
          return { status: "ja_disponivel", documentoId: existente.id, creditosCobrados: 0 };
        }
      } catch {
        // Registro sem arquivo íntegro segue para recuperação explícita por chave.
      }
    }
  }

  const { error: filaErro } = await db.from("fiscoai_dfe_recuperacoes").upsert(
    {
      user_id: userId,
      cnpj,
      chave_acesso: chave,
      provedor: "FISCALAPI",
      manifestar: false,
      status: "PENDENTE",
      tentativas: 0,
      ultimo_erro: null,
    },
    { onConflict: "user_id,cnpj,chave_acesso", ignoreDuplicates: true },
  );
  if (filaErro)
    throw new Error(`Não foi possível iniciar a recuperação do XML: ${filaErro.message}`);
  const agora = new Date();
  const token = randomUUID();
  const { data: lock, error: lockErro } = await db
    .from("fiscoai_dfe_recuperacoes")
    .update({
      lock_ate: new Date(agora.getTime() + TIMEOUT_FISCALAPI_MS + 15_000).toISOString(),
      lock_token: token,
      status: "PROCESSANDO",
      ultimo_erro: null,
      atualizado_em: agora.toISOString(),
    })
    .eq("user_id", userId)
    .eq("cnpj", cnpj)
    .eq("chave_acesso", chave)
    .lt("lock_ate", agora.toISOString())
    .select("tentativas")
    .maybeSingle();
  if (lockErro)
    throw new Error(`Não foi possível bloquear a recuperação do XML: ${lockErro.message}`);
  if (!lock) throw new Error("A recuperação deste XML já está em andamento.");
  const tentativas = Number(lock.tentativas || 0) + 1;
  const { error: tentativaErro } = await db
    .from("fiscoai_dfe_recuperacoes")
    .update({ tentativas })
    .eq("user_id", userId)
    .eq("cnpj", cnpj)
    .eq("chave_acesso", chave)
    .eq("lock_token", token);
  if (tentativaErro) {
    await db
      .from("fiscoai_dfe_recuperacoes")
      .update({
        lock_ate: new Date(0).toISOString(),
        lock_token: null,
      })
      .eq("user_id", userId)
      .eq("cnpj", cnpj)
      .eq("chave_acesso", chave)
      .eq("lock_token", token);
    throw new Error(
      `Não foi possível registrar a tentativa de recuperação: ${tentativaErro.message}`,
    );
  }

  const iniciadaEm = new Date().toISOString();
  try {
    const { data: certificado, error: certificadoErro } = await db
      .from("fiscoai_certificados_dfe")
      .select("segredo_criptografado,validade_fim")
      .eq("user_id", userId)
      .eq("cnpj", cnpj)
      .single();
    if (certificadoErro || !certificado) throw new Error("Certificado deste CNPJ não encontrado.");
    if (new Date(certificado.validade_fim) <= new Date())
      throw new Error("Certificado vencido. Cadastre um novo A1.");
    const segredo = descriptografarCertificado(certificado.segredo_criptografado);
    const resposta = await consultarFiscalApiPorChave({
      apiKey,
      chave,
      certificado: segredo.pfx,
      senha: segredo.senha,
    });
    const resultado = resposta.resultados[0];
    if (resultado.chave !== chave)
      throw new Error("A FiscalAPI respondeu com uma chave diferente da solicitada.");
    if (resultado.manifestacao !== null && resultado.manifestacao !== undefined)
      throw new Error(
        "A FiscalAPI informou uma manifestação fiscal inesperada. A recuperação foi interrompida.",
      );

    if (resultado.status !== "ok" || !resultado.xml) {
      const status = statusRecuperacao(resultado.status);
      await atualizarRecuperacao(db, userId, cnpj, chave, {
        status,
        ultimo_erro: String(resultado.mensagem || resultado.status).slice(0, 500),
      });
      await registrarTentativa(db, {
        user_id: userId,
        cnpj,
        origem: "FISCALAPI_CHAVE",
        operacao: "RECUPERAR_POR_CHAVE",
        status: resultado.status === "erro" ? "FALHA" : "SEM_DOCUMENTO",
        codigo_retorno: resultado.cstat || resultado.status,
        mensagem: String(resultado.mensagem || resultado.status).slice(0, 500),
        detalhes: {
          request_id: resposta.request_id,
          from_cache: resultado.from_cache,
          creditos_cobrados: resposta.creditos_cobrados,
        },
        iniciada_em: iniciadaEm,
        finalizada_em: new Date().toISOString(),
      });
      return {
        status: resultado.status,
        mensagem: resultado.mensagem,
        creditosCobrados: resposta.creditos_cobrados,
      };
    }

    const { xml } = validarXmlFiscalApi(resultado.xml, chave, cnpj);
    const persistido = await persistirXmlNfeCompleta({
      db,
      userId,
      cnpj,
      xml,
      origem: "FISCALAPI_CHAVE",
      metadadosOrigem: { request_id: resposta.request_id, from_cache: resultado.from_cache },
    });
    const documentoId = persistido.documentoId;

    await atualizarRecuperacao(db, userId, cnpj, chave, {
      status: "RECUPERADA",
      documento_id: documentoId,
      ultimo_erro: null,
    });
    await registrarTentativa(db, {
      user_id: userId,
      cnpj,
      documento_id: documentoId,
      origem: "FISCALAPI_CHAVE",
      operacao: "RECUPERAR_POR_CHAVE",
      status: "SUCESSO",
      codigo_retorno: resultado.cstat || "ok",
      mensagem: String(resultado.mensagem || "XML recuperado.").slice(0, 500),
      detalhes: {
        request_id: resposta.request_id,
        from_cache: resultado.from_cache,
        creditos_cobrados: resposta.creditos_cobrados,
      },
      iniciada_em: iniciadaEm,
      finalizada_em: new Date().toISOString(),
    });
    return { status: "ok", documentoId, creditosCobrados: resposta.creditos_cobrados };
  } catch (erro) {
    const mensagem = String(erro instanceof Error ? erro.message : erro).slice(0, 500);
    await atualizarRecuperacao(db, userId, cnpj, chave, {
      status: "FALHA",
      ultimo_erro: mensagem,
    }).catch(() => {});
    await registrarTentativa(db, {
      user_id: userId,
      cnpj,
      origem: "FISCALAPI_CHAVE",
      operacao: "RECUPERAR_POR_CHAVE",
      status: "FALHA",
      mensagem,
      detalhes: {},
      iniciada_em: iniciadaEm,
      finalizada_em: new Date().toISOString(),
    });
    throw erro;
  }
}
