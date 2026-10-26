import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const cnpjInput = z.object({ cnpj: z.string().regex(/^[0-9]{14}$/) });
const listaInput = z.object({
  cnpj: z.string().regex(/^[0-9]{14}$/),
  competencia: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
  offset: z.number().int().min(0).max(100000).optional().default(0),
});
const documentoInput = z.object({ id: z.string().uuid() });
const processamentoInput = z.object({ items: z.array(z.object({
  id: z.string().uuid(),
  status: z.enum(["pendente", "importada", "interna", "descartada", "falha", "ciencia_pendente"]),
  erro: z.string().max(500).optional(),
})).min(1).max(100) });

export const consultarDfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => cnpjInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { consultarDistribuicaoDfe } = await import("./distribuicaoDfe.server");
    return consultarDistribuicaoDfe(supabaseAdmin, context.userId, data.cnpj);
  });

export const listarDocumentosDfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => listaInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [ano, mes] = data.competencia.split("-").map(Number);
    const inicio = `${data.competencia}-01`;
    const proximoMes = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
    const documentosDaCompetencia = (consulta: any) => consulta.gte("data_emissao", inicio).lt("data_emissao", proximoMes);
    const contarDocumentos = (status?: string) => {
      let consulta = db.from("fiscoai_dfe_documentos").select("id", { count: "exact", head: true })
        .eq("user_id", context.userId).eq("cnpj", data.cnpj);
      if (status) consulta = consulta.eq("processamento_status", status);
      return documentosDaCompetencia(consulta);
    };
    const [pendentesResult, documentosResult, cursorResult, totalResult, importadasResult, internasResult, pendentesMesResult, falhasResult, resumosResult, falhasCienciaResult, empresasResult, certificadosResult] = await Promise.all([
      db.from("fiscoai_dfe_documentos")
        .select("id,cnpj,nsu,schema_xml,chave_acesso,sha256,recebido_em,processamento_status,processamento_erro,numero_nfe,serie_nfe,emitente_nome,emitente_cnpj,uf_origem,uf_destino,data_emissao,valor_total_xml,ciencia_cstat,ciencia_motivo,ciencia_protocolo,ciencia_enviada_em")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj)
        .like("schema_xml", "procNFe%")
        .eq("processamento_status", "pendente")
        .order("nsu", { ascending: true }).limit(100),
      documentosDaCompetencia(db.from("fiscoai_dfe_documentos")
        .select("id,cnpj,nsu,schema_xml,chave_acesso,sha256,recebido_em,processamento_status,processamento_erro,numero_nfe,serie_nfe,emitente_nome,emitente_cnpj,uf_origem,uf_destino,data_emissao,valor_total_xml,ciencia_cstat,ciencia_motivo,ciencia_protocolo,ciencia_enviada_em")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj)
        .in("processamento_status", ["importada", "interna", "falha", "pendente", "descartada", "ciencia_pendente", "ciencia_enviada", "ciencia_erro"])
        .order("data_emissao", { ascending: false, nullsFirst: false }).order("nsu", { ascending: false })
        .range(data.offset, data.offset + 99)),
      db.from("fiscoai_dfe_cursores")
        .select("ult_nsu,max_nsu,bloqueado_ate,ultimo_status,consultado_em")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj).maybeSingle(),
      contarDocumentos(), contarDocumentos("importada"), contarDocumentos("interna"), contarDocumentos("pendente"), contarDocumentos("falha"),
      documentosDaCompetencia(db.from("fiscoai_dfe_documentos").select("id", { count: "exact", head: true })
        .eq("user_id", context.userId).eq("cnpj", data.cnpj).like("schema_xml", "resNFe%").in("processamento_status", ["ciencia_pendente", "ciencia_enviada", "ciencia_erro"])),
      contarDocumentos("ciencia_erro"),
      db.from("fiscoai_empresas").select("cnpj").eq("user_id", context.userId).eq("ativa", true).eq("busca_xml_automatica", true),
      db.from("fiscoai_certificados_dfe").select("cnpj,validade_fim").eq("user_id", context.userId),
    ]);
    const falha = [pendentesResult, documentosResult, cursorResult, totalResult, importadasResult, internasResult, pendentesMesResult, falhasResult, resumosResult, falhasCienciaResult, empresasResult, certificadosResult].find(resultado => resultado.error)?.error;
    if (falha) {
      throw new Error(falha.message);
    }
    const pendentes = pendentesResult.data ?? [];
    const pagina = documentosResult.data ?? [];
    const certificadosValidos = new Set((certificadosResult.data ?? []).filter((certificado: any) => new Date(certificado.validade_fim).getTime() > Date.now()).map((certificado: any) => certificado.cnpj));
    const monitoradas = (empresasResult.data ?? []).filter((empresa: any) => certificadosValidos.has(empresa.cnpj)).length;
    return {
      documentos: pagina,
      pendentes,
      cursor: cursorResult.data,
      temMais: pagina.length === 100,
      indicadores: {
        total: totalResult.count ?? 0,
        importadas: importadasResult.count ?? 0,
        internas: internasResult.count ?? 0,
        pendentes: pendentesMesResult.count ?? 0,
        falhas: falhasResult.count ?? 0,
        resumos: resumosResult.count ?? 0,
        falhasCiencia: falhasCienciaResult.count ?? 0,
        monitoradas,
        ultimaBusca: cursorResult.data?.consultado_em || null,
      },
    };
  });

export const marcarDocumentosDfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => processamentoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const ids = [...new Set(data.items.map(item => item.id))];
    const resultados = await Promise.all(data.items.map(item => db.from("fiscoai_dfe_documentos").update({
      processamento_status: item.status,
      processamento_erro: item.status === "falha" ? (item.erro || "Falha no processamento da NF-e.") : null,
    }).eq("id", item.id).eq("user_id", context.userId)));
    const erro = resultados.find(resultado => resultado.error)?.error;
    if (erro) throw new Error(erro.message);
    return { atualizados: ids.length };
  });

export const baixarDocumentoDfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => documentoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: documento, error } = await db.from("fiscoai_dfe_documentos")
      .select("id,cnpj,nsu,schema_xml,chave_acesso,storage_path,sha256")
      .eq("id", data.id).eq("user_id", context.userId).single();
    if (error || !documento) throw new Error("Documento não encontrado nesta conta.");
    const { data: arquivo, error: arquivoErro } = await db.storage.from("fiscoai-dfe-xml").download(documento.storage_path);
    if (arquivoErro || !arquivo) throw new Error("XML não está disponível no armazenamento privado.");
    const { descriptografarXml } = await import("./certificadoDfe.server");
    const bytes = descriptografarXml(Buffer.from(await arquivo.arrayBuffer()));
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(bytes).digest("hex") !== documento.sha256) throw new Error("Integridade do XML comprometida.");
    return { ...documento, storage_path: undefined, xml: bytes.toString("utf8") };
  });
