import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

function autorizado(request: Request) {
  const esperado = process.env.CRON_SECRET || "";
  const recebido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!esperado || esperado.length !== recebido.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

export const Route = createFileRoute("/api/xml/cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!autorizado(request)) {
          return Response.json({ erro: "Não autorizado." }, { status: 401 });
        }
        try {
          const [{ supabaseAdmin }, servico] = await Promise.all([
            import("@/integrations/supabase/client.server"),
            import("@/modules/xml/services/recuperacaoXml.server"),
          ]);
          return Response.json(
            await servico.executarWorkerRecuperacao(supabaseAdmin, { limite: 5 }),
          );
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : "Falha inesperada no worker.";
          return Response.json({ erro: mensagem }, { status: 500 });
        }
      },
    },
  },
});
