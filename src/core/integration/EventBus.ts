// Barramento de eventos interno. Publish/subscribe assíncrono com
// fila, retry exponencial leve e isolamento de falhas por handler.
import { logger } from "@/core/logger";
import {
  DomainEventSchema,
  type DomainEvent,
  type EventoInput,
  type EventSubscription,
  type TipoEvento,
} from "./types";
import { EventStore } from "./EventStore";

const MAX_TENTATIVAS = 3;
const DELAY_BASE_MS = 300;

function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const assinaturas: EventSubscription[] = [];
const fila: DomainEvent[] = [];
let processando = false;

function aplica(sub: EventSubscription, tipo: TipoEvento): boolean {
  return sub.tipos === "*" || sub.tipos.includes(tipo);
}

async function entregar(evento: DomainEvent): Promise<void> {
  const alvos = assinaturas.filter((s) => aplica(s, evento.tipo));
  let houveFalha = false;

  for (const sub of alvos) {
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        await sub.handle(evento);
        break;
      } catch (err) {
        if (tentativa === MAX_TENTATIVAS) {
          houveFalha = true;
          logger.error("event-bus", `handler ${sub.nome} falhou em ${evento.tipo}`, err);
        } else {
          await new Promise((r) => setTimeout(r, DELAY_BASE_MS * tentativa));
        }
      }
    }
  }

  EventStore.atualizar(evento.id, {
    status: houveFalha ? "FALHA" : "PROCESSADO",
    tentativas: evento.tentativas + 1,
  });
}

async function drenar(): Promise<void> {
  if (processando) return;
  processando = true;
  try {
    while (fila.length) {
      const evento = fila.shift()!;
      EventStore.atualizar(evento.id, { status: "PROCESSANDO" });
      await entregar(evento);
    }
  } finally {
    processando = false;
  }
}

export const EventBus = {
  /** Registra um assinante. Idempotente por nome. */
  subscribe(sub: EventSubscription): () => void {
    const idx = assinaturas.findIndex((s) => s.nome === sub.nome);
    if (idx >= 0) assinaturas[idx] = sub;
    else assinaturas.push(sub);
    return () => {
      const i = assinaturas.findIndex((s) => s.nome === sub.nome);
      if (i >= 0) assinaturas.splice(i, 1);
    };
  },

  assinantes(): string[] { return assinaturas.map((s) => s.nome); },

  /** Publica um evento (não bloqueia o chamador). */
  publish(input: EventoInput): DomainEvent {
    const evento = DomainEventSchema.parse({
      id: novoId(),
      tipo: input.tipo,
      origem: input.origem,
      destino: input.destino ?? [],
      data: new Date().toISOString(),
      versaoContrato: "1.0",
      contexto: {
        usuarioId: input.contexto?.usuarioId ?? null,
        empresaId: input.contexto?.empresaId ?? null,
        competencia: input.contexto?.competencia ?? null,
        processoId: input.contexto?.processoId ?? null,
        tarefaId: input.contexto?.tarefaId ?? null,
        execucaoId: input.contexto?.execucaoId ?? null,
        produtoId: input.contexto?.produtoId ?? null,
      },
      objeto: { tipo: input.objeto?.tipo ?? "GENERICO", id: input.objeto?.id ?? null },
      payload: input.payload ?? {},
      status: "PENDENTE",
      tentativas: 0,
      erro: null,
    });

    EventStore.append(evento);
    fila.push(evento);
    void drenar();
    return evento;
  },

  /** Publica e aguarda o processamento (uso em fluxos transacionais/testes). */
  async publishAndWait(input: EventoInput): Promise<DomainEvent> {
    const evento = EventBus.publish(input);
    await drenar();
    return evento;
  },
};
