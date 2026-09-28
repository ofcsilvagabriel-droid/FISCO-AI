// Server functions da camada de decisões validadas de ICMS-ST.
// Leitura pública (chave publicável) e gravação privilegiada — o
// navegador nunca escreve direto na tabela.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RegistrarInput = z.object({
  ncm_prefixo: z.string().min(2),
  assinatura_descricao: z.string().min(1),
  status_confirmado: z.enum(["ST_CONFIRMADA", "NAO_ENQUADRADO"]),
  regra_id: z.string().nullable().optional(),
  observacao: z.string().nullable().optional(),
});

export const listarDecisoesValidadas = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase
    .from("st_decisoes_validadas")
    .select("id, ncm_prefixo, assinatura_descricao, status_confirmado, regra_id, validado_em, observacao")
    .order("validado_em", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const registrarDecisaoValidada = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RegistrarInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("st_decisoes_validadas")
      .insert({
        ncm_prefixo: data.ncm_prefixo,
        assinatura_descricao: data.assinatura_descricao,
        status_confirmado: data.status_confirmado,
        regra_id: data.regra_id ?? null,
        observacao: data.observacao ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
