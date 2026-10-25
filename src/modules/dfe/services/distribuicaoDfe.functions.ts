import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const cnpjInput = z.object({ cnpj: z.string().regex(/^[0-9]{14}$/) });
const documentoInput = z.object({ id: z.string().uuid() });
const processamentoInput = z.object({ items: z.array(z.object({
  id: z.string().uuid(),
  status: z.enum(["pendente", "importada", "descartada", "falha"]),
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
  .validator((entrada: unknown) => cnpjInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [pendentesResult, recentesResult, cursorResult] = await Promise.all([
      db.from("fiscoai_dfe_documentos")
        .select("id,cnpj,nsu,schema_xml,chave_acesso,sha256,recebido_em,processamento_status,processamento_erro,numero_nfe,serie_nfe,emitente_nome,emitente_cnpj,uf_origem,uf_destino,data_emissao,valor_total_xml")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj)
        .like("schema_xml", "procNFe%")
        .eq("processamento_status", "pendente")
        .order("nsu", { ascending: true }).limit(100),
      db.from("fiscoai_dfe_documentos")
        .select("id,cnpj,nsu,schema_xml,chave_acesso,sha256,recebido_em,processamento_status,processamento_erro,numero_nfe,serie_nfe,emitente_nome,emitente_cnpj,uf_origem,uf_destino,data_emissao,valor_total_xml")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj)
        .like("schema_xml", "procNFe%")
        .in("processamento_status", ["importada", "falha"])
        .order("nsu", { ascending: false }).limit(100),
      db.from("fiscoai_dfe_cursores")
        .select("ult_nsu,max_nsu,bloqueado_ate,ultimo_status,consultado_em")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj).maybeSingle(),
    ]);
    if (pendentesResult.error || recentesResult.error || cursorResult.error) {
      throw new Error(pendentesResult.error?.message || recentesResult.error?.message || cursorResult.error?.message);
    }
    const pendentes = pendentesResult.data ?? [];
    const documentos = [...pendentes, ...(recentesResult.data ?? [])];
    return { documentos, pendentes, cursor: cursorResult.data };
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
