import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const cnpjInput = z.object({ cnpj: z.string().regex(/^[0-9]{14}$/) });
const documentoInput = z.object({ id: z.string().uuid() });

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
    const [{ data: documentos, error }, { data: cursor, error: cursorErro }] = await Promise.all([
      db.from("fiscoai_dfe_documentos")
        .select("id,cnpj,nsu,schema_xml,chave_acesso,sha256,recebido_em")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj)
        .order("nsu", { ascending: false }).limit(100),
      db.from("fiscoai_dfe_cursores")
        .select("ult_nsu,max_nsu,bloqueado_ate,ultimo_status,consultado_em")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj).maybeSingle(),
    ]);
    if (error || cursorErro) throw new Error(error?.message || cursorErro?.message);
    return { documentos: documentos ?? [], cursor };
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
