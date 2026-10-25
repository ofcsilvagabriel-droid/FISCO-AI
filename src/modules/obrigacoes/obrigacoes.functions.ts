import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const competenciaSchema = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
const dataSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
const competenciaInput = z.object({ competencia: competenciaSchema });
const prepararInput = z.object({
  competencia: competenciaSchema,
  vencimentos: z.object({
    ANTECIPACAO_PARCIAL: dataSchema.optional().nullable(),
    ANTECIPACAO_TRIBUTARIA: dataSchema.optional().nullable(),
    DIFAL: dataSchema.optional().nullable(),
  }),
});
const obrigacaoInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["PENDENTE", "ENVIADO", "SEM_MOVIMENTO", "NA_PASTA"]),
  vencimento: dataSchema.optional().nullable(),
  valor_guia: z.number().min(0).max(999999999999).optional().nullable(),
  data_envio: dataSchema.optional().nullable(),
  observacoes: z.string().max(4000).optional().nullable(),
});

export const listarObrigacoesIcms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => competenciaInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any).from("fiscoai_obrigacoes_icms")
      .select("id,empresa_cnpj,competencia,tipo,status,vencimento,valor_guia,data_envio,observacoes,atualizado_em")
      .eq("user_id", context.userId).eq("competencia", data.competencia).order("empresa_cnpj").order("tipo");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const prepararObrigacoesIcms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => prepararInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: empresas, error: empresasErro } = await db.from("fiscoai_empresas")
      .select("cnpj").eq("user_id", context.userId).eq("ativa", true);
    if (empresasErro) throw new Error(empresasErro.message);
    if (!empresas?.length) throw new Error("Cadastre pelo menos uma empresa ativa antes de preparar a competência.");
    const tipos = ["ANTECIPACAO_PARCIAL", "ANTECIPACAO_TRIBUTARIA", "DIFAL"] as const;
    const rows = empresas.flatMap((empresa: { cnpj: string }) => tipos.map(tipo => ({
      user_id: context.userId,
      empresa_cnpj: empresa.cnpj,
      competencia: data.competencia,
      tipo,
      status: "PENDENTE",
      vencimento: data.vencimentos[tipo] || null,
    })));
    const { error } = await db.from("fiscoai_obrigacoes_icms").upsert(rows, {
      onConflict: "user_id,empresa_cnpj,competencia,tipo",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
    return { empresas: empresas.length, registros_preparados: rows.length };
  });

export const salvarObrigacaoIcms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => obrigacaoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any).from("fiscoai_obrigacoes_icms").update({
      status: data.status,
      vencimento: data.vencimento || null,
      valor_guia: data.valor_guia ?? null,
      data_envio: data.data_envio || null,
      observacoes: data.observacoes || null,
      atualizado_em: new Date().toISOString(),
    }).eq("id", data.id).eq("user_id", context.userId)
      .select("id,empresa_cnpj,competencia,tipo,status,vencimento,valor_guia,data_envio,observacoes,atualizado_em")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
