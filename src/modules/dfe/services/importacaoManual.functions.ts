/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LIMITE_XML_DFE = 10 * 1024 * 1024;

const importacaoInput = z.object({
  empresaCnpj: z
    .string()
    .regex(/^[0-9]{14}$/)
    .optional(),
  xml: z.string().min(1).max(LIMITE_XML_DFE),
});

export const importarXmlManualNoHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => importacaoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { identificarParticipantesXmlNfeCompleta, persistirXmlNfeCompleta } =
      await import("./documentoFiscal.server");
    const { reconciliarPendenciasComAcervo } =
      await import("@/modules/xml/services/recuperacaoXml.server");
    const db = supabaseAdmin as any;
    const bytes = Buffer.from(data.xml, "utf8");
    const identificado = identificarParticipantesXmlNfeCompleta(bytes);
    const participantes = [identificado.destinatario_cnpj, identificado.emitente_cnpj].filter(
      (cnpj, indice, todos) => /^\d{14}$/.test(cnpj) && todos.indexOf(cnpj) === indice,
    );
    const { data: empresas, error: empresaErro } = await db
      .from("fiscoai_empresas")
      .select("empresa_id,cnpj")
      .eq("user_id", context.userId)
      .in("cnpj", participantes);
    const empresa =
      (empresas || []).find((item: { cnpj: string }) => item.cnpj === data.empresaCnpj) ||
      empresas?.find((item: { cnpj: string }) => item.cnpj === identificado.destinatario_cnpj) ||
      empresas?.find((item: { cnpj: string }) => item.cnpj === identificado.emitente_cnpj);
    if (empresaErro || !empresa) {
      throw new Error("Cadastre uma empresa participante da NF-e antes de guardar o XML no Hub.");
    }
    const iniciadaEm = new Date().toISOString();
    try {
      const resultado = await persistirXmlNfeCompleta({
        db,
        userId: context.userId,
        cnpj: empresa.cnpj,
        xml: bytes,
        origem: "IMPORTACAO_MANUAL",
        metadadosOrigem: { identificacao_participante: "XML_CONFIRMADO" },
      });
      const reconciliacao = await reconciliarPendenciasComAcervo(db, {
        userId: context.userId,
        chaveAcesso: resultado.detalhes.chave_acesso,
      });
      await db.from("fiscoai_xml_auditoria").insert({
        user_id: context.userId,
        empresa_cnpj: empresa.cnpj,
        documento_id: resultado.documentoId,
        operacao: "IMPORTAR_XML",
        status: "SUCESSO",
        mensagem: resultado.duplicado ? "NF-e já existente no Hub." : "NF-e importada no Hub.",
        detalhes: {
          duplicado: resultado.duplicado,
          pendencias_resolvidas: reconciliacao.itensResolvidos,
          lotes_atualizados: reconciliacao.lotesAtualizados,
        },
        criado_em: iniciadaEm,
        finalizado_em: new Date().toISOString(),
      });
      return { ...resultado, empresaCnpj: empresa.cnpj, reconciliacao };
    } catch (erro) {
      const mensagem = String(erro instanceof Error ? erro.message : erro).slice(0, 500);
      await db.from("fiscoai_xml_auditoria").insert({
        user_id: context.userId,
        empresa_cnpj: empresa?.cnpj || identificado.destinatario_cnpj || identificado.emitente_cnpj,
        operacao: "IMPORTAR_XML",
        status: "FALHA",
        mensagem,
        detalhes: {},
        criado_em: iniciadaEm,
        finalizado_em: new Date().toISOString(),
      });
      throw erro;
    }
  });
