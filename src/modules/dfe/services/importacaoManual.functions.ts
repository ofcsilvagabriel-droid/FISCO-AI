/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LIMITE_XML_DFE = 10 * 1024 * 1024;

const importacaoInput = z.object({
  empresaCnpj: z.string().regex(/^[0-9]{14}$/),
  xml: z.string().min(1).max(LIMITE_XML_DFE),
});

export const importarXmlManualNoHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => importacaoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { persistirXmlNfeCompleta } = await import("./documentoFiscal.server");
    const db = supabaseAdmin as any;
    const { data: empresa, error: empresaErro } = await db
      .from("fiscoai_empresas")
      .select("cnpj")
      .eq("user_id", context.userId)
      .eq("cnpj", data.empresaCnpj)
      .maybeSingle();
    if (empresaErro || !empresa) {
      throw new Error("Cadastre a empresa destinatária antes de guardar o XML no Hub.");
    }
    const iniciadaEm = new Date().toISOString();
    try {
      const resultado = await persistirXmlNfeCompleta({
        db,
        userId: context.userId,
        cnpj: data.empresaCnpj,
        xml: Buffer.from(data.xml, "utf8"),
        origem: "IMPORTACAO_MANUAL",
      });
      await db.from("fiscoai_dfe_tentativas").insert({
        user_id: context.userId,
        cnpj: data.empresaCnpj,
        documento_id: resultado.documentoId,
        origem: "IMPORTACAO_MANUAL",
        operacao: "IMPORTAR_XML",
        status: "SUCESSO",
        mensagem: resultado.duplicado ? "NF-e já existente no Hub." : "NF-e importada no Hub.",
        detalhes: { duplicado: resultado.duplicado },
        iniciada_em: iniciadaEm,
        finalizada_em: new Date().toISOString(),
      });
      return resultado;
    } catch (erro) {
      const mensagem = String(erro instanceof Error ? erro.message : erro).slice(0, 500);
      await db.from("fiscoai_dfe_tentativas").insert({
        user_id: context.userId,
        cnpj: data.empresaCnpj,
        origem: "IMPORTACAO_MANUAL",
        operacao: "IMPORTAR_XML",
        status: "FALHA",
        mensagem,
        detalhes: {},
        iniciada_em: iniciadaEm,
        finalizada_em: new Date().toISOString(),
      });
      throw erro;
    }
  });
