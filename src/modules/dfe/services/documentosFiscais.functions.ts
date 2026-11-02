/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const documentoInput = z.object({ id: z.string().uuid() });
const documentosLoteInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(25) });
const exportacaoInput = z.object({
  cnpj: z.string().regex(/^[0-9]{14}$/),
  competencia: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
  pagina: z.number().int().min(0).default(0),
  limite: z.number().int().min(1).max(200).default(200),
});
const processamentoInput = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["pendente", "importada", "interna", "descartada", "falha"]),
        erro: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const marcarDocumentosFiscais = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => processamentoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const ids = [...new Set(data.items.map((item) => item.id))];
    const { data: completos, error: leituraErro } = await db
      .from("fiscoai_dfe_documentos")
      .select("id,tipo_conteudo")
      .eq("user_id", context.userId)
      .in("id", ids);
    if (
      leituraErro ||
      completos?.length !== ids.length ||
      completos.some((documento: any) => documento.tipo_conteudo !== "XML_COMPLETO")
    ) {
      throw new Error("Somente XMLs completos da sua conta podem ser processados.");
    }
    const resultados = await Promise.all(
      data.items.map((item) =>
        db
          .from("fiscoai_dfe_documentos")
          .update({
            processamento_status: item.status,
            processamento_erro:
              item.status === "falha" ? item.erro || "Falha no processamento da NF-e." : null,
            atualizado_em: new Date().toISOString(),
          })
          .eq("id", item.id)
          .eq("user_id", context.userId),
      ),
    );
    const erro = resultados.find((resultado) => resultado.error)?.error;
    if (erro) throw new Error(erro.message);
    const processados = data.items
      .filter((item) => ["importada", "interna"].includes(item.status))
      .map((item) => item.id);
    if (processados.length) {
      const { error: filaErro } = await db
        .from("fiscoai_xml_itens")
        .update({ status: "IMPORTADA", atualizado_em: new Date().toISOString() })
        .eq("user_id", context.userId)
        .in("documento_id", processados)
        .in("status", ["ARMAZENADA", "DUPLICADA"]);
      if (filaErro) throw new Error(filaErro.message);
    }
    return { atualizados: ids.length };
  });

export const baixarDocumentoFiscal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => documentoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    return carregarXmlDocumentoFiscal(db, context.userId, data.id);
  });

export const listarDocumentosFiscaisParaExportacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => exportacaoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [ano, mes] = data.competencia.split("-").map(Number);
    const inicio = `${data.competencia}-01`;
    const proximoMes = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
    const inicioPagina = data.pagina * data.limite;
    const { data: documentos, error } = await db
      .from("fiscoai_dfe_documentos")
      .select("id,chave_acesso,numero_nfe,serie_nfe,data_emissao")
      .eq("user_id", context.userId)
      .eq("cnpj", data.cnpj)
      .eq("tipo_conteudo", "XML_COMPLETO")
      .gte("data_emissao", inicio)
      .lt("data_emissao", proximoMes)
      .order("data_emissao", { ascending: true })
      .range(inicioPagina, inicioPagina + data.limite - 1);
    if (error) throw new Error(error.message);
    return {
      documentos: documentos || [],
      proximaPagina: (documentos || []).length === data.limite,
    };
  });

export const baixarDocumentosFiscaisEmLote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => documentosLoteInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const documentos = await Promise.all(
      [...new Set(data.ids)].map((id) => carregarXmlDocumentoFiscal(db, context.userId, id)),
    );
    const empresas = [...new Set(documentos.map((documento) => documento.cnpj))];
    if (empresas.length !== 1) throw new Error("Exporte documentos de uma empresa por vez.");
    const { error: auditoriaErro } = await db.from("fiscoai_xml_auditoria").insert({
      user_id: context.userId,
      empresa_cnpj: empresas[0],
      operacao: "EXPORTAR_XML",
      status: "SUCESSO",
      mensagem: `${documentos.length} XML(s) exportado(s).`,
      detalhes: { documentos: documentos.map((documento) => documento.id) },
      finalizado_em: new Date().toISOString(),
    });
    if (auditoriaErro)
      throw new Error(`Não foi possível auditar a exportação: ${auditoriaErro.message}`);
    return { documentos };
  });

async function carregarXmlDocumentoFiscal(db: any, userId: string, id: string) {
  const { data: documento, error } = await db
    .from("fiscoai_dfe_documentos")
    .select("id,cnpj,tipo_conteudo,chave_acesso,storage_path,sha256")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error || !documento) throw new Error("Documento não encontrado nesta conta.");
  if (documento.tipo_conteudo !== "XML_COMPLETO") {
    throw new Error("O XML completo desta NF-e ainda não está disponível.");
  }
  const { data: arquivo, error: arquivoErro } = await db.storage
    .from("fiscoai-dfe-xml")
    .download(documento.storage_path);
  if (arquivoErro || !arquivo) {
    throw new Error("XML não está disponível no armazenamento privado.");
  }
  const { descriptografarXml } = await import("./certificadoDfe.server");
  const bytes = descriptografarXml(Buffer.from(await arquivo.arrayBuffer()));
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(bytes).digest("hex") !== documento.sha256) {
    throw new Error("Integridade do XML comprometida.");
  }
  return {
    id: documento.id,
    cnpj: documento.cnpj,
    chave_acesso: documento.chave_acesso,
    xml: bytes.toString("utf8"),
  };
}
