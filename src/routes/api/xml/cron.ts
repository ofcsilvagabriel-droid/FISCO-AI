/* eslint-disable @typescript-eslint/no-explicit-any */
import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

function autorizadoPelaVercel(request: Request) {
  const esperado = process.env.CRON_SECRET || "";
  const recebido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!esperado || esperado.length !== recebido.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

async function autorizadoPeloSupabase(db: any, request: Request) {
  const recebido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!recebido) return false;
  const { data, error } = await db.rpc("fiscoai_validar_token_worker", {
    p_token: recebido,
  });
  return !error && data === true;
}

export const Route = createFileRoute("/api/xml/cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const [{ supabaseAdmin }, servico] = await Promise.all([
            import("@/integrations/supabase/client.server"),
            import("@/modules/xml/services/recuperacaoXml.server"),
          ]);
          if (
            !autorizadoPelaVercel(request) &&
            !(await autorizadoPeloSupabase(supabaseAdmin, request))
          ) {
            return Response.json({ erro: "Não autorizado." }, { status: 401 });
          }
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
