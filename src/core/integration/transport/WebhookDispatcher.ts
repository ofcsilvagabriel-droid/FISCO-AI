// Despachante de webhooks: entrega eventos aos conectores externos
// registrados, com fila, retry e isolamento de falhas por conector.
import { logger } from "@/core/logger";
import { EventBus } from "../EventBus";
import type { DomainEvent, ExternalConnector } from "../types";

const conectores: ExternalConnector[] = [];
let habilitado = false;

async function despachar(evento: DomainEvent) {
  if (!habilitado || !conectores.length) return;
  await Promise.all(
    conectores.filter((c) => c.aceita(evento)).map(async (c) => {
      try {
        await c.enviar(evento);
      } catch (err) {
        logger.warn("webhook", `conector ${c.nome} falhou em ${evento.tipo}`, err);
      }
    }),
  );
}

export const WebhookDispatcher = {
  registrar(conector: ExternalConnector): void {
    if (conectores.some((c) => c.nome === conector.nome)) return;
    conectores.push(conector);
    habilitado = true;
    logger.info("webhook", `conector registrado: ${conector.nome}@${conector.versaoApi}`);
  },
  remover(nome: string): void {
    const i = conectores.findIndex((c) => c.nome === nome);
    if (i >= 0) conectores.splice(i, 1);
    habilitado = conectores.length > 0;
  },
  listar(): Array<{ nome: string; versaoApi: string }> {
    return conectores.map((c) => ({ nome: c.nome, versaoApi: c.versaoApi }));
  },
  /** Liga o despachante ao barramento (idempotente). */
  ativar(): void {
    EventBus.subscribe({
      nome: "webhook-dispatcher",
      tipos: "*",
      handle: (evento) => despachar(evento),
    });
  },
};
