import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { solicitacaoRecuperacaoXmlSchema } from "@/modules/dfe/domain/documentoFiscal";

const entradaSchema = solicitacaoRecuperacaoXmlSchema.pick({
  empresaCnpj: true,
  chaveAcesso: true,
});

export const recuperarXmlPorChave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => entradaSchema.parse(entrada))
  .handler(async ({ data, context }) => {
    const [{ supabaseAdmin }, { recuperarXmlFiscalApi }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./fiscalApi.server"),
    ]);
    return recuperarXmlFiscalApi(supabaseAdmin, context.userId, data.empresaCnpj, data.chaveAcesso);
  });
