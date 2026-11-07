/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";

const MAX_ITENS = 50;
const TENTATIVAS_POR_CICLO = 5;
const STATUS_XML_RESOLVIDO = ["ARMAZENADA", "IMPORTADA", "DUPLICADA"];

export async function reconciliarPendenciasComAcervo(
  db: any,
  entrada: { userId: string; chaveAcesso?: string },
) {
  let consultaItens = db
    .from("fiscoai_xml_itens")
    .select("id,lote_id,chave_acesso,status")
    .eq("user_id", entrada.userId)
    .not("status", "in", `(${STATUS_XML_RESOLVIDO.map((status) => `"${status}"`).join(",")})`)
    .limit(500);
  if (entrada.chaveAcesso) consultaItens = consultaItens.eq("chave_acesso", entrada.chaveAcesso);
  const { data: itens, error: itensErro } = await consultaItens;
  if (itensErro) throw new Error(`Falha ao localizar pendências da NF-e: ${itensErro.message}`);
  if (!itens?.length) return { itensResolvidos: 0, lotesAtualizados: 0 };

  const chaves = [...new Set(itens.map((item: any) => item.chave_acesso))];
  const { data: documentos, error: documentosErro } = await db
    .from("fiscoai_dfe_documentos")
    .select("id,cnpj,chave_acesso,processamento_status")
    .eq("user_id", entrada.userId)
    .eq("tipo_conteudo", "XML_COMPLETO")
    .in("chave_acesso", chaves);
  if (documentosErro) throw new Error(`Falha ao conferir o acervo de XMLs: ${documentosErro.message}`);
  if (!documentos?.length) return { itensResolvidos: 0, lotesAtualizados: 0 };

  const cnpjs = [...new Set(documentos.map((documento: any) => documento.cnpj))];
  const { data: empresas, error: empresasErro } = await db
    .from("fiscoai_empresas")
    .select("empresa_id,cnpj")
    .eq("user_id", entrada.userId)
    .in("cnpj", cnpjs);
  if (empresasErro) throw new Error(`Falha ao identificar a empresa do XML: ${empresasErro.message}`);
  const empresaPorCnpj = new Map((empresas || []).map((empresa: any) => [empresa.cnpj, empresa]));
  const lotes = new Set<string>();
  let itensResolvidos = 0;
  const agora = new Date().toISOString();

  for (const documento of documentos) {
    const empresa = empresaPorCnpj.get(documento.cnpj) as any;
    if (!empresa) continue;
    const correspondentes = itens.filter((item: any) => item.chave_acesso === documento.chave_acesso);
    const ids = correspondentes.map((item: any) => item.id);
    if (!ids.length) continue;
    const status = ["importada", "interna"].includes(documento.processamento_status)
      ? "IMPORTADA"
      : "ARMAZENADA";
    const { error: atualizacaoErro } = await db
      .from("fiscoai_xml_itens")
      .update({
        empresa_id: empresa.empresa_id,
        empresa_cnpj: documento.cnpj,
        destinatario_cnpj_informado: documento.cnpj,
        identificacao_origem: "XML_CONFIRMADO",
        documento_id: documento.id,
        status,
        lock_token: null,
        lock_ate: "1970-01-01T00:00:00.000Z",
        proxima_tentativa_em: null,
        ultimo_codigo: "XML_RECONCILIADO_COM_ACERVO",
        ultimo_erro: null,
        atualizado_em: agora,
      })
      .eq("user_id", entrada.userId)
      .in("id", ids);
    if (atualizacaoErro) throw new Error(`Falha ao atualizar a pendência da NF-e: ${atualizacaoErro.message}`);
    const { error: notificacaoErro } = await db
      .from("fiscoai_xml_notificacoes")
      .update({ resolvida_em: agora, atualizado_em: agora })
      .eq("user_id", entrada.userId)
      .in("item_id", ids)
      .is("resolvida_em", null);
    if (notificacaoErro) throw new Error(`Falha ao resolver a notificação da NF-e: ${notificacaoErro.message}`);
    correspondentes.forEach((item: any) => lotes.add(item.lote_id));
    itensResolvidos += ids.length;
  }
  for (const loteId of lotes) await atualizarTotaisLote(db, loteId);
  return { itensResolvidos, lotesAtualizados: lotes.size };
}

export async function reivindicarItensRecuperacao(db: any, limite = 10, userId?: string) {
  const lockToken = randomUUID();
  const parametros = {
    p_limite: Math.max(1, Math.min(Number(limite) || 10, userId ? 10 : MAX_ITENS)),
    p_lock_token: lockToken,
    ...(userId ? { p_user_id: userId } : {}),
  };
  const { data, error } = await db.rpc(
    userId ? "fiscoai_reivindicar_itens_xml_usuario" : "fiscoai_reivindicar_itens_xml",
    parametros,
  );
  if (error) throw new Error(`Não foi possível reivindicar a fila: ${error.message}`);
  return {
    lockToken,
    itens: (data || []).map((item: any) => ({
      id: item.id,
      loteId: item.lote_id,
      userId: item.user_id,
      empresaCnpj: item.empresa_cnpj,
      chaveAcesso: item.chave_acesso,
      tentativa: item.tentativas,
    })),
  };
}

export async function executarWorkerRecuperacao(
  db: any,
  entrada: { limite?: number; userId?: string } = {},
) {
  const { consultarXmlConsultaDanfe, ErroConsultaDanfe } = await import("./consultaDanfe.server");
  const { consultarXmlNfeOrquestrado, ErroConsultaNfeOrquestrada, orquestradorNfeAtivo } =
    await import("./consultaNfeOrchestrator.server");
  const usarOrquestrador = orquestradorNfeAtivo();
  const lote = await reivindicarItensRecuperacao(db, entrada.limite || 5, entrada.userId);
  const resultados = await Promise.all(
    lote.itens.map(async (item: any) => {
      let xml: string;
      let metadadosConsulta:
        | { provedor: "CONSULTA_DANFE" | "NFE_IO"; provedoresConsultados: string[] }
        | undefined;
      try {
        if (usarOrquestrador) {
          const consulta = await consultarXmlNfeOrquestrado(db, {
            userId: item.userId,
            itemId: item.id,
            chave: item.chaveAcesso,
          });
          xml = consulta.xml!.toString("utf8");
          if (!consulta.cacheHit) {
            metadadosConsulta = {
              provedor: consulta.provedor,
              provedoresConsultados: consulta.provedoresConsultados,
            };
          }
        } else {
          xml = await consultarXmlConsultaDanfe(item.chaveAcesso);
        }
      } catch (erro) {
        const conhecido =
          erro instanceof ErroConsultaDanfe || erro instanceof ErroConsultaNfeOrquestrada;
        const falha = await falharItemRecuperacao(db, {
          itemId: item.id,
          lockToken: lote.lockToken,
          codigo: conhecido ? erro.codigo : "FALHA_PROVEDOR",
          mensagem: erro instanceof Error ? erro.message : "O provedor externo não devolveu o XML.",
          repetivel: conhecido ? erro.repetivel : true,
          retryAfterMs: erro instanceof ErroConsultaNfeOrquestrada ? erro.retryAfterMs : undefined,
        });
        return { itemId: item.id, resultado: falha.status };
      }
      try {
        const concluido = await concluirItemRecuperacao(db, {
          itemId: item.id,
          lockToken: lote.lockToken,
          xml,
          ...metadadosConsulta,
        });
        return {
          itemId: item.id,
          resultado: "RECUPERADO",
          aguardandoEmpresa: "aguardandoEmpresa" in concluido,
        };
      } catch {
        return { itemId: item.id, resultado: "XML_REJEITADO" };
      }
    }),
  );
  return {
    reivindicados: resultados.length,
    recuperados: resultados.filter((item) => item.resultado === "RECUPERADO").length,
    adiados: resultados.filter((item) => item.resultado === "PROVEDOR_INDISPONIVEL").length,
    falhas: resultados.filter((item) =>
      ["FALHA_DEFINITIVA", "XML_REJEITADO"].includes(item.resultado),
    ).length,
  };
}

export async function concluirItemRecuperacao(
  db: any,
  entrada: {
    itemId: string;
    lockToken: string;
    xml: string;
    provedor?: "CONSULTA_DANFE" | "NFE_IO";
    provedoresConsultados?: string[];
  },
) {
  const { data: item, error: itemErro } = await db
    .from("fiscoai_xml_itens")
    .select(
      "id,lote_id,user_id,empresa_id,empresa_cnpj,chave_acesso,destinatario_cnpj_informado,status,lock_token",
    )
    .eq("id", entrada.itemId)
    .eq("lock_token", entrada.lockToken)
    .eq("status", "CONSULTANDO")
    .maybeSingle();
  if (itemErro || !item) throw new Error("Item não encontrado ou concessão do worker expirada.");

  let resultado;
  let empresaConfirmada: any = null;
  try {
    const {
      identificarDestinatarioXmlNfeCompleta,
      persistirXmlNfeCompleta,
      validarXmlNfeCompleta,
    } = await import("@/modules/dfe/services/documentoFiscal.server");
    const bytes = Buffer.from(entrada.xml, "utf8");
    const identificado = identificarDestinatarioXmlNfeCompleta(bytes);
    if (identificado.chave_acesso !== item.chave_acesso) {
      throw new Error("O XML devolvido pelo provedor não corresponde à chave reivindicada.");
    }
    resultado = await persistirXmlNfeCompleta({
      db,
      userId: item.user_id,
      cnpj: identificado.destinatario_cnpj,
      xml: bytes,
      origem: "API_PROPRIA",
      metadadosOrigem: {
        item_fila_id: item.id,
        provedor: entrada.provedor || "WORKER_AUTORIZADO",
        provedores_consultados: entrada.provedoresConsultados || [],
        identificacao_destinatario: "XML_CONFIRMADO",
        cnpj_planilha: item.destinatario_cnpj_informado || null,
      },
    });
    if (entrada.provedor) {
      const { error: provedorErro } = await db
        .from("fiscoai_dfe_documentos")
        .update({
          provedor_preferido: entrada.provedor,
          provedores_consultados: entrada.provedoresConsultados || [entrada.provedor],
          consultado_em: new Date().toISOString(),
        })
        .eq("id", resultado.documentoId)
        .eq("user_id", item.user_id);
      if (provedorErro) {
        throw new Error(`Falha ao registrar o provedor da NF-e: ${provedorErro.message}`);
      }
    }
    const { data: empresa, error: empresaErro } = await db
      .from("fiscoai_empresas")
      .select("empresa_id,cnpj")
      .eq("user_id", item.user_id)
      .eq("cnpj", identificado.destinatario_cnpj)
      .maybeSingle();
    if (empresaErro)
      throw new Error(`Falha ao identificar a empresa destinatária: ${empresaErro.message}`);
    if (!empresa) {
      const agora = new Date().toISOString();
      const { error: esperaErro } = await db
        .from("fiscoai_xml_itens")
        .update({
          status: "AGUARDANDO_EMPRESA",
          destinatario_cnpj_informado: identificado.destinatario_cnpj,
          identificacao_origem: "XML_CONFIRMADO",
          documento_id: resultado.documentoId,
          lock_token: null,
          lock_ate: "1970-01-01T00:00:00.000Z",
          proxima_tentativa_em: null,
          ultimo_codigo: "DESTINATARIO_NAO_CADASTRADO",
          ultimo_erro:
            "Cadastre a empresa destinatária confirmada pelo XML para repetir a recuperação.",
          atualizado_em: agora,
        })
        .eq("id", item.id)
        .eq("lock_token", entrada.lockToken);
      if (esperaErro) throw new Error(esperaErro.message);
      await db.from("fiscoai_xml_auditoria").insert({
        user_id: item.user_id,
        empresa_cnpj: identificado.destinatario_cnpj,
        documento_id: resultado.documentoId,
        item_id: item.id,
        operacao: "IDENTIFICAR_DESTINATARIO_XML",
        status: "BLOQUEADA",
        codigo_retorno: "DESTINATARIO_NAO_CADASTRADO",
        mensagem: "XML confirmado, mas a empresa destinatária ainda não está cadastrada.",
        detalhes: { chave_acesso: item.chave_acesso },
        finalizado_em: agora,
      });
      await db.from("fiscoai_xml_notificacoes").upsert(
        {
          user_id: item.user_id,
          empresa_cnpj: null,
          item_id: item.id,
          fingerprint: `${item.id}:DESTINATARIO_NAO_CADASTRADO`,
          tipo: "DESTINATARIO_NAO_CADASTRADO",
          severidade: "ATENCAO",
          titulo: "Empresa destinatária não cadastrada",
          mensagem: `O XML ${item.chave_acesso} foi recuperado, mas o destinatário ainda não está cadastrado.`,
        },
        { onConflict: "user_id,fingerprint", ignoreDuplicates: true },
      );
      await atualizarTotaisLote(db, item.lote_id);
      return {
        aguardandoEmpresa: true,
        destinatarioCnpj: identificado.destinatario_cnpj,
        documentoId: resultado.documentoId,
      };
    }
    empresaConfirmada = empresa;
    validarXmlNfeCompleta(bytes, empresa.cnpj);
    const { error: identificacaoErro } = await db
      .from("fiscoai_xml_itens")
      .update({
        empresa_id: empresa.empresa_id,
        empresa_cnpj: empresa.cnpj,
        destinatario_cnpj_informado: empresa.cnpj,
        identificacao_origem: "XML_CONFIRMADO",
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("lock_token", entrada.lockToken);
    if (identificacaoErro)
      throw new Error(`Falha ao vincular a NF-e à empresa correta: ${identificacaoErro.message}`);
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
    empresa_id: empresaConfirmada.empresa_id,
    empresa_cnpj: empresaConfirmada.cnpj,
    documento_id: resultado.documentoId,
    item_id: item.id,
    operacao: "RECUPERAR_XML",
    status: "SUCESSO",
    mensagem: resultado.duplicado ? "XML já existente e validado." : "XML recuperado e validado.",
    detalhes: {
      chave_acesso: item.chave_acesso,
      duplicado: resultado.duplicado,
      destinatario_confirmado_pelo_xml: true,
      cnpj_informado_na_entrada: item.destinatario_cnpj_informado || null,
    },
    finalizado_em: agora,
  });
  await db
    .from("fiscoai_xml_notificacoes")
    .update({ resolvida_em: agora, atualizado_em: agora })
    .eq("user_id", item.user_id)
    .eq("item_id", item.id)
    .is("resolvida_em", null);
  await atualizarTotaisLote(db, item.lote_id);
  await db
    .from("fiscoai_empresa_integracoes")
    .update({
      status: "ATIVA",
      ultima_execucao_em: agora,
      ultimo_sucesso_em: agora,
      ultimo_erro: null,
      atualizado_em: agora,
    })
    .eq("user_id", item.user_id)
    .eq("empresa_id", empresaConfirmada.empresa_id)
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
    retryAfterMs?: number;
  },
) {
  const { data: item, error } = await db
    .from("fiscoai_xml_itens")
    .select("id,lote_id,user_id,empresa_id,empresa_cnpj,tentativas,ciclo_tentativas,chave_acesso")
    .eq("id", entrada.itemId)
    .eq("lock_token", entrada.lockToken)
    .eq("status", "CONSULTANDO")
    .maybeSingle();
  if (error || !item) throw new Error("Item não encontrado ou concessão do worker expirada.");
  const repetivel = entrada.repetivel !== false;
  const fimDoCiclo = Number(item.ciclo_tentativas || 0) >= TENTATIVAS_POR_CICLO;
  const agora = new Date();
  const esperaMinutos = repetivel
    ? fimDoCiclo
      ? 360
      : Math.min(60, 2 ** Math.max(0, Number(item.ciclo_tentativas || 1) - 1))
    : 24 * 60;
  const esperaMs = Math.max(esperaMinutos * 60 * 1000, entrada.retryAfterMs || 0);
  const proxima = new Date(agora.getTime() + esperaMs).toISOString();
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
      ciclo_tentativas: fimDoCiclo || !repetivel ? 0 : item.ciclo_tentativas,
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
  await db.from("fiscoai_xml_notificacoes").upsert(
    {
      user_id: item.user_id,
      empresa_id: item.empresa_id,
      empresa_cnpj: item.empresa_cnpj,
      item_id: item.id,
      fingerprint: `${item.id}:${entrada.codigo || "FALHA_PROVEDOR"}`,
      tipo: "FALHA_RECUPERACAO",
      severidade: repetivel ? "ATENCAO" : "CRITICA",
      titulo: repetivel ? "Recuperação de XML adiada" : "XML exige nova tentativa",
      mensagem: `NF-e ${item.chave_acesso}: ${mensagem}`.slice(0, 1000),
    },
    { onConflict: "user_id,fingerprint", ignoreDuplicates: true },
  );
  await atualizarTotaisLote(db, item.lote_id);
  await db
    .from("fiscoai_empresa_integracoes")
    .update({
      status: "ERRO",
      ultima_execucao_em: agora.toISOString(),
      ultimo_erro: mensagem,
      atualizado_em: agora.toISOString(),
    })
    .eq("user_id", item.user_id)
    .eq("empresa_id", item.empresa_id)
    .eq("tipo", "RECUPERACAO_XML");
  return { status, proximaTentativaEm: proxima };
}

export async function atualizarTotaisLote(db: any, loteId: string) {
  const { data: itens, error } = await db
    .from("fiscoai_xml_itens")
    .select("status")
    .eq("lote_id", loteId);
  if (error) throw new Error(error.message);
  const recuperados = (itens || []).filter((item: any) =>
    STATUS_XML_RESOLVIDO.includes(item.status),
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
    .update({
      total_recuperados: recuperados,
      total_falhas: falhas,
      status,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", loteId);
}
