import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const cadastro = z.object({
  cnpj: z.string().regex(/^[0-9]{14}$/),
  nome: z.string().trim().min(1).max(120),
  pfxBase64: z.string().min(100).max(100000),
  senha: z.string().min(1).max(256),
});

const cnpjInput = z.object({ cnpj: z.string().regex(/^[0-9]{14}$/) });

export const listarCertificadosDfe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data, error } = await db.from("fiscoai_certificados_dfe")
      .select("cnpj,nome,titular,validade_inicio,validade_fim,fingerprint_sha256,atualizado_em")
      .eq("user_id", context.userId).order("nome");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const salvarCertificadoDfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => cadastro.parse(entrada))
  .handler(async ({ data, context }) => {
    const { criptografarCertificado, inspecionarCertificado } = await import("./certificadoDfe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const metadados = inspecionarCertificado(data.pfxBase64, data.senha);
    const segredo = criptografarCertificado({ pfx: data.pfxBase64, senha: data.senha });
    const { error } = await db.from("fiscoai_certificados_dfe").upsert({
      user_id: context.userId, cnpj: data.cnpj, nome: data.nome,
      ...metadados, segredo_criptografado: segredo, atualizado_em: new Date().toISOString(),
    }, { onConflict: "user_id,cnpj" });
    if (error) throw new Error(error.message);
    const { error: cursorErro } = await db.from("fiscoai_dfe_cursores")
      .upsert({ user_id: context.userId, cnpj: data.cnpj }, { onConflict: "user_id,cnpj", ignoreDuplicates: true });
    if (cursorErro) throw new Error(cursorErro.message);
    return { cnpj: data.cnpj, ...metadados };
  });

export const excluirCertificadoDfe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => cnpjInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { error } = await db.from("fiscoai_certificados_dfe").delete()
      .eq("user_id", context.userId).eq("cnpj", data.cnpj);
    if (error) throw new Error(error.message);
    return { removido: true };
  });
