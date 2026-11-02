/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";

const MAX_ITENS = 50;
const TENTATIVAS_MAXIMAS = 5;

export async function reivindicarItensRecuperacao(db: any, limite = 10) {
  const lockToken = randomUUID();
  const { data, error } = await db.rpc("fiscoai_reivindicar_itens_xml", {
    p_limite: Math.max(1, Math.min(Number(limite) || 10, MAX_ITENS)),
    p_lock_token: lockToken,
  });
  if (error) throw new Error(`Não foi possível reivindicar a fila: ${error.message}`);
  return {
    lockToken,
    itens: (data || []).map((item: any) => ({
      id: item.id,
      loteId: item.lote_id,
      empresaCnpj: item.empresa_cnpj,
      chaveAcesso: item.chave_acesso,
      tentativa: item.tentativas,
    })),
  };
}

export async function concluirItemRecuperacao(
  db: any,
  entrada: { itemId: string; lockToken: string; xml: string },
) {
  const { data: item, error: itemErro } = await db
    .from("fiscoai_xml_itens")
    .select("id,lote_id,user_id,empresa_id,empresa_cnpj,chave_acesso,status,lock_token")
    .eq("id", entrada.itemId)
    .eq("lock_token", entrada.lockToken)
    .eq("status", "CONSULTANDO")
    .maybeSingle();
  if (itemErro || !item) throw new Error("Item não encontrado ou concessão do worker expirada.");

  let resultado;
  try {
    const { persistirXmlNfeCompleta, validarXmlNfeCompleta } = await import("@/modules/dfe/services/documentoFiscal.server");
    const bytes = Buffer.from(entrada.xml, "utf8");
    const validado = validarXmlNfeCompleta(bytes, item.empresa_cnpj);
    if (validado.chave_acesso !== item.chave_acesso) {
      throw new Error("O XML devolvido pelo provedor não corresponde à chave reivindicada.");
    }
    resultado = await persistirXmlNfeCompleta({
      db,
      userId: item.user_id,
      cnpj: item.empresa_cnpj,
      xml: bytes,
      origem: "API_PROPRIA",
      metadadosOrigem: { item_fila_id: item.id, provedor: "WORKER_AUTORIZADO" },
    });
  } catch (erro) {
    await falharItemRecuperacao(db, {
      itemId: entrada.itemId,
      lockToken: entrada.lockToken,
      codigo: "XML_REJEITADO",
      mensagem: erro instanceof Error ? erro.message : "XML rejeitado na validação.",
      repetivel: false,
    });
    throw erro;
  }

  const agora = new Date().toISOString();
  const { error: atualizacaoErro } = await db
    .from("fiscoai_xml_itens")
    .update({
      status: resultado.duplicado ? "DUPLICADA" : "ARMAZENADA",
      documento_id: resultado.documentoId,
      lock_token: null,
      lock_ate: "1970-01-01T00:00:00.000Z",
      proxima_tentativa_em: null,
      ultimo_codigo: "XML_VALIDADO",
      ultimo_erro: null,
      atualizado_em: agora,
    })
    .eq("id", item.id)
    .eq("lock_token", entrada.lockToken);
  if (atualizacaoErro) throw new Error(atualizacaoErro.message);

  await db.from("fiscoai_xml_auditoria").insert({
    user_id: item.user_id,
    empresa_id: item.empresa_id,
    empresa_cnpj: item.empresa_cnpj,
    documento_id: resultado.documentoId,
    item_id: item.id,
    operacao: "RECUPERAR_XML",
    status: "SUCESSO",
    mensagem: resultado.duplicado ? "XML já existente e validado." : "XML recuperado e validado.",
    detalhes: { chave_acesso: item.chave_acesso, duplicado: resultado.duplicado },
    finalizado_em: agora,
  });
  await atualizarTotaisLote(db, item.lote_id);
  await db
    .from("fiscoai_empresa_integracoes")
    .update({ status: "ATIVA", ultima_execucao_em: agora, ultimo_sucesso_em: agora, ultimo_erro: null, atualizado_em: agora })
    .eq("user_id", item.user_id)
    .eq("empresa_id", item.empresa_id)
    .eq("tipo", "RECUPERACAO_XML");
  return { documentoId: resultado.documentoId, duplicado: resultado.duplicado };
}

export async function falharItemRecuperacao(
  db: any,
  entrada: {
    itemId: string;
    lockToken: string;
    codigo?: string;
    mensagem: string;
    repetivel?: boolean;
  },
) {
  const { data: item, error } = await db
    .from("fiscoai_xml_itens")
    .select("id,lote_id,user_id,empresa_id,empresa_cnpj,tentativas")
    .eq("id", entrada.itemId)
    .eq("lock_token", entrada.lockToken)
    .eq("status", "CONSULTANDO")
    .maybeSingle();
  if (error || !item) throw new Error("Item não encontrado ou concessão do worker expirada.");
  const repetivel = entrada.repetivel !== false && item.tentativas < TENTATIVAS_MAXIMAS;
  const agora = new Date();
  const proxima = repetivel
    ? new Date(agora.getTime() + Math.min(24, 2 ** item.tentativas) * 60 * 60 * 1000).toISOString()
    : null;
  const status = repetivel ? "PROVEDOR_INDISPONIVEL" : "FALHA_DEFINITIVA";
  const mensagem = entrada.mensagem.slice(0, 500);
  const { error: atualizacaoErro } = await db
    .from("fiscoai_xml_itens")
    .update({
      status,
      proxima_tentativa_em: proxima,
      lock_token: null,
      lock_ate: "1970-01-01T00:00:00.000Z",
      ultimo_codigo: entrada.codigo?.slice(0, 80) || null,
      ultimo_erro: mensagem,
      atualizado_em: agora.toISOString(),
    })
    .eq("id", item.id)
    .eq("lock_token", entrada.lockToken);
  if (atualizacaoErro) throw new Error(atualizacaoErro.message);
  await db.from("fiscoai_xml_auditoria").insert({
    user_id: item.user_id,
    empresa_id: item.empresa_id,
    empresa_cnpj: item.empresa_cnpj,
    item_id: item.id,
    operacao: "RECUPERAR_XML",
    status: repetivel ? "BLOQUEADA" : "FALHA",
    codigo_retorno: entrada.codigo?.slice(0, 80) || null,
    mensagem,
    detalhes: { repetivel, proxima_tentativa_em: proxima },
    finalizado_em: agora.toISOString(),
  });
  await atualizarTotaisLote(db, item.lote_id);
  await db
    .from("fiscoai_empresa_integracoes")
    .update({ status: "ERRO", ultima_execucao_em: agora.toISOString(), ultimo_erro: mensagem, atualizado_em: agora.toISOString() })
    .eq("user_id", item.user_id)
    .eq("empresa_id", item.empresa_id)
    .eq("tipo", "RECUPERACAO_XML");
  return { status, proximaTentativaEm: proxima };
}

async function atualizarTotaisLote(db: any, loteId: string) {
  const { data: itens, error } = await db
    .from("fiscoai_xml_itens")
    .select("status")
    .eq("lote_id", loteId);
  if (error) throw new Error(error.message);
  const recuperados = (itens || []).filter((item: any) =>
    ["ARMAZENADA", "IMPORTADA", "DUPLICADA"].includes(item.status),
  ).length;
  const falhas = (itens || []).filter((item: any) => item.status === "FALHA_DEFINITIVA").length;
  const pendentes = (itens || []).length - recuperados - falhas;
  const status = pendentes
    ? "PROCESSANDO"
    : falhas
      ? recuperados
        ? "CONCLUIDO_COM_FALHAS"
        : "CONCLUIDO_COM_FALHAS"
      : "CONCLUIDO";
  await db
    .from("fiscoai_xml_lotes")
    .update({ total_recuperados: recuperados, total_falhas: falhas, status, atualizado_em: new Date().toISOString() })
    .eq("id", loteId);
}
