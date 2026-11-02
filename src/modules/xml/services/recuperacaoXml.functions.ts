/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chaveNfeValida } from "@/modules/xml/domain/chaveNfe";

const CNPJ = z.string().regex(/^[0-9]{14}$/);
const CHAVE = z.string().regex(/^[0-9]{44}$/);

const criarLoteInput = z.object({
  cnpj: CNPJ,
  chaves: z.array(CHAVE).min(1).max(500),
  origem: z.enum(["CHAVES_COLADAS", "ARQUIVO_CHAVES"]).default("CHAVES_COLADAS"),
});

const listarInput = z.object({
  cnpj: CNPJ,
  competencia: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
});

export const criarLoteRecuperacaoXml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => criarLoteInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const chaves = [...new Set(data.chaves.map(chave => chave.trim()))];
    const invalidas = chaves.filter(chave => !chaveNfeValida(chave));
    if (invalidas.length) {
      throw new Error(`${invalidas.length} chave(s) não representam uma NF-e modelo 55 válida.`);
    }
    const { data: empresa, error: empresaErro } = await db
      .from("fiscoai_empresas")
      .select("empresa_id,cnpj")
      .eq("user_id", context.userId)
      .eq("cnpj", data.cnpj)
      .maybeSingle();
    if (empresaErro || !empresa) throw new Error("Empresa não encontrada nesta conta.");

    const { data: lote, error: loteErro } = await db
      .from("fiscoai_xml_lotes")
      .insert({
        user_id: context.userId,
        empresa_id: empresa.empresa_id,
        empresa_cnpj: empresa.cnpj,
        origem_entrada: data.origem,
        total_itens: chaves.length,
      })
      .select("id")
      .single();
    if (loteErro || !lote) throw new Error(loteErro?.message || "Não foi possível criar o lote.");

    const { data: existentes, error: existentesErro } = await db
      .from("fiscoai_xml_itens")
      .select("chave_acesso")
      .eq("user_id", context.userId)
      .eq("empresa_id", empresa.empresa_id)
      .in("chave_acesso", chaves);
    if (existentesErro) throw new Error(existentesErro.message);
    const jaExistentes = new Set((existentes || []).map((item: any) => item.chave_acesso));
    const novas = chaves.filter(chave => !jaExistentes.has(chave));
    if (novas.length) {
      const { error: itensErro } = await db.from("fiscoai_xml_itens").insert(
        novas.map(chave => ({
          lote_id: lote.id,
          user_id: context.userId,
          empresa_id: empresa.empresa_id,
          empresa_cnpj: empresa.cnpj,
          chave_acesso: chave,
        })),
      );
      if (itensErro) throw new Error(itensErro.message);
    }
    await db.from("fiscoai_xml_lotes").update({
      total_itens: novas.length,
      status: novas.length ? "PENDENTE" : "CONCLUIDO",
      atualizado_em: new Date().toISOString(),
    }).eq("id", lote.id).eq("user_id", context.userId);
    return { loteId: lote.id, enfileiradas: novas.length, duplicadas: chaves.length - novas.length };
  });

export const listarCentralXml = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => listarInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [ano, mes] = data.competencia.split("-").map(Number);
    const inicio = `${data.competencia}-01`;
    const proximoMes = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
    const contarItens = (status: string[]) => db.from("fiscoai_xml_itens").select("id", { count: "exact", head: true })
      .eq("user_id", context.userId).eq("empresa_cnpj", data.cnpj).in("status", status);
    const contarDocumentos = (status?: string) => {
      let consulta = db.from("fiscoai_dfe_documentos").select("id", { count: "exact", head: true })
        .eq("user_id", context.userId).eq("cnpj", data.cnpj).eq("tipo_conteudo", "XML_COMPLETO")
        .gte("data_emissao", inicio).lt("data_emissao", proximoMes);
      if (status) consulta = consulta.eq("processamento_status", status);
      return consulta;
    };
    const [{ data: empresa, error: empresaErro }, lotes, itens, documentos, naFila, recuperadas, falhas, totalDocs, importadas, internas] = await Promise.all([
      db.from("fiscoai_empresas").select("empresa_id,cnpj").eq("user_id", context.userId).eq("cnpj", data.cnpj).maybeSingle(),
      db.from("fiscoai_xml_lotes").select("id,status,origem_entrada,total_itens,total_recuperados,total_falhas,criado_em,atualizado_em")
        .eq("user_id", context.userId).eq("empresa_cnpj", data.cnpj).order("criado_em", { ascending: false }).limit(30),
      db.from("fiscoai_xml_itens").select("id,lote_id,chave_acesso,provedor,status,tentativas,ultimo_codigo,ultimo_erro,criado_em,atualizado_em")
        .eq("user_id", context.userId).eq("empresa_cnpj", data.cnpj).order("criado_em", { ascending: false }).limit(200),
      db.from("fiscoai_dfe_documentos").select("id,chave_acesso,numero_nfe,serie_nfe,emitente_nome,uf_origem,uf_destino,data_emissao,valor_total_xml,processamento_status,origem,recebido_em")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj).eq("tipo_conteudo", "XML_COMPLETO")
        .gte("data_emissao", inicio).lt("data_emissao", proximoMes)
        .order("data_emissao", { ascending: false }).limit(200),
      contarItens(["NA_FILA", "CONSULTANDO", "BAIXADA", "VALIDANDO_XML"]),
      contarItens(["ARMAZENADA", "IMPORTADA", "DUPLICADA"]),
      contarItens(["NAO_ENCONTRADA", "XML_INCOMPLETO", "PROVEDOR_INDISPONIVEL", "BLOQUEADA", "FALHA_DEFINITIVA"]),
      contarDocumentos(),
      contarDocumentos("importada"),
      contarDocumentos("interna"),
    ]);
    const erro = empresaErro || [lotes, itens, documentos, naFila, recuperadas, falhas, totalDocs, importadas, internas].find(resultado => resultado.error)?.error;
    if (erro) throw new Error(erro.message);
    if (!empresa) throw new Error("Empresa não encontrada nesta conta.");
    const fila = itens.data || [];
    const docs = documentos.data || [];
    return {
      lotes: lotes.data || [],
      itens: fila,
      documentos: docs,
      indicadores: {
        naFila: naFila.count || 0,
        recuperadas: recuperadas.count || 0,
        falhas: falhas.count || 0,
        documentos: totalDocs.count || 0,
        importadas: importadas.count || 0,
        internas: internas.count || 0,
      },
    };
  });
