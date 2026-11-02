import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const requisicao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("reivindicar"), limite: z.number().int().min(1).max(50).optional() }),
  z.object({
    acao: z.literal("concluir"),
    itemId: z.string().uuid(),
    lockToken: z.string().uuid(),
    xml: z.string().min(1).max(10 * 1024 * 1024),
  }),
  z.object({
    acao: z.literal("falhar"),
    itemId: z.string().uuid(),
    lockToken: z.string().uuid(),
    codigo: z.string().max(80).optional(),
    mensagem: z.string().min(1).max(500),
    repetivel: z.boolean().optional(),
  }),
]);

function autorizado(request: Request) {
  const esperado = process.env.FISCOAI_WORKER_SECRET || "";
  const recebido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!esperado || esperado.length !== recebido.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}

export const Route = createFileRoute("/api/xml/worker")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        autorizado(request)
          ? Response.json({ status: "pronto", provedor: "WORKER_AUTORIZADO" })
          : Response.json({ erro: "Não autorizado." }, { status: 401 }),
      POST: async ({ request }) => {
        if (!autorizado(request)) {
          return Response.json({ erro: "Não autorizado." }, { status: 401 });
        }
        try {
          const entrada = requisicao.parse(await request.json());
          const [{ supabaseAdmin }, servico] = await Promise.all([
            import("@/integrations/supabase/client.server"),
            import("@/modules/xml/services/recuperacaoXml.server"),
          ]);
          const db = supabaseAdmin as any;
          if (entrada.acao === "reivindicar") {
            return Response.json(await servico.reivindicarItensRecuperacao(db, entrada.limite));
          }
          if (entrada.acao === "concluir") {
            return Response.json(await servico.concluirItemRecuperacao(db, entrada));
          }
          return Response.json(await servico.falharItemRecuperacao(db, entrada));
        } catch (erro) {
          const mensagem = erro instanceof Error ? erro.message : "Falha inesperada no worker.";
          return Response.json({ erro: mensagem }, { status: 400 });
        }
      },
    },
  },
});
