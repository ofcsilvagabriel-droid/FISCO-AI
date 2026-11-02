/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chaveNfeValida } from "@/modules/xml/domain/chaveNfe";

const CNPJ = z.string().regex(/^[0-9]{14}$/);
const CHAVE = z.string().regex(/^[0-9]{44}$/);
const itemEntrada = z.object({
  chave: CHAVE,
  destinatarioCnpj: CNPJ.optional().nullable(),
  destinatarioNome: z.string().trim().max(180).optional().nullable(),
  emitenteCnpj: z.string().trim().max(20).optional().nullable(),
  emitenteNome: z.string().trim().max(180).optional().nullable(),
  numeroNfe: z.string().trim().max(30).optional().nullable(),
  dataEmissao: z.string().trim().max(40).optional().nullable(),
  linha: z.number().int().positive().optional().nullable(),
});

const criarLoteInput = z
  .object({
    cnpj: CNPJ.optional(),
    chaves: z.array(CHAVE).min(1).max(500).optional(),
    itens: z.array(itemEntrada).min(1).max(500).optional(),
    origem: z.enum(["CHAVES_COLADAS", "ARQUIVO_CHAVES"]).default("CHAVES_COLADAS"),
    nomeArquivo: z.string().trim().max(255).optional().nullable(),
    arquivoSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .nullable(),
    totalLinhas: z.number().int().min(0).optional(),
  })
  .refine((entrada) => Boolean(entrada.chaves?.length || entrada.itens?.length), {
    message: "Informe ao menos uma chave de acesso.",
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
    const itensEntrada = data.itens || (data.chaves || []).map((chave) => ({ chave }));
    const chaves = [...new Set(itensEntrada.map((item) => item.chave.trim()))];
    const invalidas = chaves.filter((chave) => !chaveNfeValida(chave));
    if (invalidas.length) {
      throw new Error(`${invalidas.length} chave(s) não representam uma NF-e modelo 55 válida.`);
    }
    const destinos = [
      ...new Set(itensEntrada.map((item) => item.destinatarioCnpj).filter(Boolean)),
    ];
    let empresas: any[] = [];
    if (destinos.length) {
      const consulta = await db
        .from("fiscoai_empresas")
        .select("empresa_id,cnpj,razao_social")
        .eq("user_id", context.userId)
        .in("cnpj", destinos);
      if (consulta.error) throw new Error(consulta.error.message);
      empresas = consulta.data || [];
    }
    const empresasPorCnpj = new Map(empresas.map((empresa: any) => [empresa.cnpj, empresa]));
    const atribuicoes = itensEntrada.map((item) => ({
      item,
      empresaIndicada: item.destinatarioCnpj
        ? empresasPorCnpj.get(item.destinatarioCnpj) || null
        : null,
    }));
    const empresasAtribuidas = [
      ...new Map(
        atribuicoes
          .filter((item) => item.empresaIndicada)
          .map((item) => [item.empresaIndicada.cnpj, item.empresaIndicada]),
      ).values(),
    ];
    if (data.arquivoSha256) {
      const { data: arquivoExistente, error: arquivoErro } = await db
        .from("fiscoai_xml_lotes")
        .select("id,criado_em")
        .eq("user_id", context.userId)
        .eq("arquivo_sha256", data.arquivoSha256)
        .maybeSingle();
      if (arquivoErro) throw new Error(arquivoErro.message);
      if (arquivoExistente) {
        throw new Error(`Esta planilha já foi importada em ${new Date(arquivoExistente.criado_em).toLocaleString("pt-BR")}.`);
      }
    }

    const { data: lote, error: loteErro } = await db
      .from("fiscoai_xml_lotes")
      .insert({
        user_id: context.userId,
        empresa_id: null,
        empresa_cnpj: null,
        origem_entrada: data.origem,
        total_itens: chaves.length,
        nome_arquivo: data.nomeArquivo || null,
        arquivo_sha256: data.arquivoSha256 || null,
        total_linhas: data.totalLinhas || itensEntrada.length,
        metadados_entrada: {
          destinatario_na_planilha: destinos.length > 0,
          empresas_indicadas: empresasAtribuidas.length,
          vinculo_definitivo: "XML_COMPLETO",
        },
      })
      .select("id")
      .single();
    if (loteErro || !lote) throw new Error(loteErro?.message || "Não foi possível criar o lote.");

    const { data: existentes, error: existentesErro } = await db
      .from("fiscoai_xml_itens")
      .select("chave_acesso")
      .eq("user_id", context.userId)
      .in("chave_acesso", chaves);
    if (existentesErro) throw new Error(existentesErro.message);
    const jaExistentes = new Set((existentes || []).map((item: any) => item.chave_acesso));
    const novas = atribuicoes.filter(({ item }) => !jaExistentes.has(item.chave));
    if (novas.length) {
      const { error: itensErro } = await db.from("fiscoai_xml_itens").insert(
        novas.map(({ item }) => ({
          lote_id: lote.id,
          user_id: context.userId,
          empresa_id: null,
          empresa_cnpj: null,
          chave_acesso: item.chave,
          destinatario_cnpj_informado: item.destinatarioCnpj || null,
          destinatario_nome_informado: item.destinatarioNome || null,
          emitente_cnpj_informado: item.emitenteCnpj || null,
          emitente_nome_informado: item.emitenteNome || null,
          numero_nfe_informado: item.numeroNfe || null,
          data_emissao_informada: item.dataEmissao || null,
          linha_origem: item.linha || null,
          identificacao_origem: "PENDENTE",
        })),
      );
      if (itensErro) throw new Error(itensErro.message);
    }
    await db
      .from("fiscoai_xml_lotes")
      .update({
        total_itens: novas.length,
        status: novas.length ? "PENDENTE" : "CONCLUIDO",
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", lote.id)
      .eq("user_id", context.userId);
    await db.from("fiscoai_xml_auditoria").insert({
      user_id: context.userId,
      empresa_id: null,
      empresa_cnpj: null,
      operacao: "IMPORTAR_CAIXA_ENTRADA",
      status: "SUCESSO",
      mensagem: `${novas.length} chave(s) recebida(s) pelo ambiente de Importação de Planilhas.`,
      detalhes: {
        lote_id: lote.id,
        nome_arquivo: data.nomeArquivo || null,
        empresas_indicadas: empresasAtribuidas.length,
        aguardando_identificacao: novas.length,
      },
      finalizado_em: new Date().toISOString(),
    });
    return {
      loteId: lote.id,
      enfileiradas: novas.length,
      duplicadas: chaves.length - novas.length,
      identificadas: 0,
      indicadas: novas.filter((item) => item.item.destinatarioCnpj).length,
      aguardandoIdentificacao: novas.length,
    };
  });

export const listarImportacoesPlanilhas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("fiscoai_xml_lotes")
      .select(
        "id,nome_arquivo,arquivo_sha256,status,total_linhas,total_itens,total_recuperados,total_falhas,criado_em,atualizado_em",
      )
      .eq("user_id", context.userId)
      .eq("origem_entrada", "ARQUIVO_CHAVES")
      .order("criado_em", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data || [];
  });

export const listarPendenciasXml = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [itens, empresas, notificacoes] = await Promise.all([
      db
        .from("fiscoai_xml_itens")
        .select(
          "id,chave_acesso,empresa_cnpj,destinatario_cnpj_informado,status,ultimo_codigo,ultimo_erro,atualizado_em",
        )
        .eq("user_id", context.userId)
        .not("status", "in", '("ARMAZENADA","IMPORTADA","DUPLICADA")')
        .order("atualizado_em", { ascending: false })
        .limit(500),
      db
        .from("fiscoai_empresas")
        .select("cnpj,razao_social,nome_fantasia")
        .eq("user_id", context.userId),
      db
        .from("fiscoai_xml_notificacoes")
        .select(
          "id,empresa_cnpj,item_id,tipo,severidade,titulo,mensagem,lida_em,resolvida_em,criado_em",
        )
        .eq("user_id", context.userId)
        .is("resolvida_em", null)
        .order("criado_em", { ascending: false })
        .limit(100),
    ]);
    const erro = [itens, empresas, notificacoes].find((resultado) => resultado.error)?.error;
    if (erro) throw new Error(erro.message);
    const nomes = new Map(
      (empresas.data || []).map((empresa: any) => [
        empresa.cnpj,
        empresa.nome_fantasia || empresa.razao_social,
      ]),
    );
    const porEmpresa = new Map<string, any>();
    for (const item of itens.data || []) {
      const cnpj = item.empresa_cnpj || item.destinatario_cnpj_informado || "SEM_EMPRESA";
      if (!porEmpresa.has(cnpj))
        porEmpresa.set(cnpj, {
          cnpj,
          nome: nomes.get(cnpj) || (cnpj === "SEM_EMPRESA" ? "Aguardando identificação" : cnpj),
          total: 0,
          falhas: 0,
        });
      const resumo = porEmpresa.get(cnpj);
      resumo.total += 1;
      if (
        [
          "NAO_ENCONTRADA",
          "XML_INCOMPLETO",
          "PROVEDOR_INDISPONIVEL",
          "BLOQUEADA",
          "FALHA_DEFINITIVA",
        ].includes(item.status)
      )
        resumo.falhas += 1;
    }
    const abertas = notificacoes.data || [];
    return {
      total: (itens.data || []).length,
      empresas: [...porEmpresa.values()].sort((a, b) => b.total - a.total),
      notificacoes: abertas,
      naoLidas: abertas.filter((item: any) => !item.lida_em).length,
    };
  });

export const marcarNotificacaoXmlLida = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => z.object({ id: z.string().uuid() }).parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("fiscoai_xml_notificacoes")
      .update({ lida_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .is("lida_em", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listarCaixaEntradaFiscal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: aguardandoEmpresa, error: aguardandoErro } = await db
      .from("fiscoai_xml_itens")
      .select("id,destinatario_cnpj_informado")
      .eq("user_id", context.userId)
      .eq("status", "AGUARDANDO_EMPRESA")
      .not("destinatario_cnpj_informado", "is", null);
    if (aguardandoErro) throw new Error(aguardandoErro.message);
    const cnpjsPendentes = [
      ...new Set((aguardandoEmpresa || []).map((item: any) => item.destinatario_cnpj_informado)),
    ];
    if (cnpjsPendentes.length) {
      const { data: empresasPendentes, error: empresasErro } = await db
        .from("fiscoai_empresas")
        .select("empresa_id,cnpj")
        .eq("user_id", context.userId)
        .in("cnpj", cnpjsPendentes);
      if (empresasErro) throw new Error(empresasErro.message);
      const porCnpj = new Map(
        (empresasPendentes || []).map((empresa: any) => [empresa.cnpj, empresa]),
      );
      await Promise.all(
        (aguardandoEmpresa || []).map((item: any) => {
          const empresa = porCnpj.get(item.destinatario_cnpj_informado);
          if (!empresa) return Promise.resolve();
          return db
            .from("fiscoai_xml_itens")
            .update({
              empresa_id: empresa.empresa_id,
              empresa_cnpj: empresa.cnpj,
              status: "NA_FILA",
              ultimo_codigo: "EMPRESA_CADASTRADA",
              ultimo_erro: null,
              atualizado_em: new Date().toISOString(),
            })
            .eq("id", item.id)
            .eq("user_id", context.userId)
            .eq("status", "AGUARDANDO_EMPRESA");
        }),
      );
    }
    const [lotes, itens, total, aguardando, identificadas, recuperadas, falhas] = await Promise.all(
      [
        db
          .from("fiscoai_xml_lotes")
          .select(
            "id,nome_arquivo,origem_entrada,status,total_itens,total_recuperados,total_falhas,criado_em,atualizado_em",
          )
          .eq("user_id", context.userId)
          .order("criado_em", { ascending: false })
          .limit(30),
        db
          .from("fiscoai_xml_itens")
          .select(
            "id,lote_id,chave_acesso,empresa_cnpj,destinatario_cnpj_informado,destinatario_nome_informado,emitente_nome_informado,numero_nfe_informado,linha_origem,identificacao_origem,status,tentativas,ultimo_codigo,ultimo_erro,criado_em,atualizado_em",
          )
          .eq("user_id", context.userId)
          .order("criado_em", { ascending: false })
          .limit(300),
        db
          .from("fiscoai_xml_itens")
          .select("id", { count: "exact", head: true })
          .eq("user_id", context.userId),
        db
          .from("fiscoai_xml_itens")
          .select("id", { count: "exact", head: true })
          .eq("user_id", context.userId)
          .is("empresa_cnpj", null)
          .in("status", [
            "NA_FILA",
            "CONSULTANDO",
            "PROVEDOR_INDISPONIVEL",
            "BLOQUEADA",
            "AGUARDANDO_EMPRESA",
          ]),
        db
          .from("fiscoai_xml_itens")
          .select("id", { count: "exact", head: true })
          .eq("user_id", context.userId)
          .not("empresa_cnpj", "is", null),
        db
          .from("fiscoai_xml_itens")
          .select("id", { count: "exact", head: true })
          .eq("user_id", context.userId)
          .in("status", ["ARMAZENADA", "IMPORTADA", "DUPLICADA"]),
        db
          .from("fiscoai_xml_itens")
          .select("id", { count: "exact", head: true })
          .eq("user_id", context.userId)
          .in("status", ["NAO_ENCONTRADA", "XML_INCOMPLETO", "FALHA_DEFINITIVA"]),
      ],
    );
    const erro = [lotes, itens, total, aguardando, identificadas, recuperadas, falhas].find(
      (resultado) => resultado.error,
    )?.error;
    if (erro) throw new Error(erro.message);
    return {
      lotes: lotes.data || [],
      itens: itens.data || [],
      indicadores: {
        total: total.count || 0,
        aguardandoIdentificacao: aguardando.count || 0,
        identificadas: identificadas.count || 0,
        recuperadas: recuperadas.count || 0,
        falhas: falhas.count || 0,
      },
    };
  });

export const processarCaixaEntradaFiscal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) =>
    z.object({ limite: z.number().int().min(1).max(10).default(5) }).parse(entrada),
  )
  .handler(async ({ data, context }) => {
    const [{ supabaseAdmin }, servico] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./recuperacaoXml.server"),
    ]);
    return servico.executarWorkerRecuperacao(supabaseAdmin as any, {
      limite: data.limite,
      userId: context.userId,
    });
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
    const contarItens = (status: string[]) =>
      db
        .from("fiscoai_xml_itens")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId)
        .eq("empresa_cnpj", data.cnpj)
        .in("status", status);
    const contarDocumentos = (status?: string) => {
      let consulta = db
        .from("fiscoai_dfe_documentos")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId)
        .eq("cnpj", data.cnpj)
        .eq("tipo_conteudo", "XML_COMPLETO")
        .gte("data_emissao", inicio)
        .lt("data_emissao", proximoMes);
      if (status) consulta = consulta.eq("processamento_status", status);
      return consulta;
    };
    const [
      { data: empresa, error: empresaErro },
      lotes,
      itens,
      documentos,
      naFila,
      recuperadas,
      falhas,
      totalDocs,
      importadas,
      internas,
    ] = await Promise.all([
      db
        .from("fiscoai_empresas")
        .select("empresa_id,cnpj")
        .eq("user_id", context.userId)
        .eq("cnpj", data.cnpj)
        .maybeSingle(),
      db
        .from("fiscoai_xml_lotes")
        .select(
          "id,status,origem_entrada,total_itens,total_recuperados,total_falhas,criado_em,atualizado_em",
        )
        .eq("user_id", context.userId)
        .eq("empresa_cnpj", data.cnpj)
        .order("criado_em", { ascending: false })
        .limit(30),
      db
        .from("fiscoai_xml_itens")
        .select(
          "id,lote_id,chave_acesso,provedor,status,tentativas,ultimo_codigo,ultimo_erro,criado_em,atualizado_em",
        )
        .eq("user_id", context.userId)
        .eq("empresa_cnpj", data.cnpj)
        .order("criado_em", { ascending: false })
        .limit(200),
      db
        .from("fiscoai_dfe_documentos")
        .select(
          "id,chave_acesso,numero_nfe,serie_nfe,emitente_nome,uf_origem,uf_destino,data_emissao,valor_total_xml,processamento_status,origem,recebido_em",
        )
        .eq("user_id", context.userId)
        .eq("cnpj", data.cnpj)
        .eq("tipo_conteudo", "XML_COMPLETO")
        .gte("data_emissao", inicio)
        .lt("data_emissao", proximoMes)
        .order("data_emissao", { ascending: false })
        .limit(200),
      contarItens(["NA_FILA", "CONSULTANDO", "BAIXADA", "VALIDANDO_XML"]),
      contarItens(["ARMAZENADA", "IMPORTADA", "DUPLICADA"]),
      contarItens([
        "NAO_ENCONTRADA",
        "XML_INCOMPLETO",
        "PROVEDOR_INDISPONIVEL",
        "BLOQUEADA",
        "FALHA_DEFINITIVA",
      ]),
      contarDocumentos(),
      contarDocumentos("importada"),
      contarDocumentos("interna"),
    ]);
    const erro =
      empresaErro ||
      [lotes, itens, documentos, naFila, recuperadas, falhas, totalDocs, importadas, internas].find(
        (resultado) => resultado.error,
      )?.error;
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
