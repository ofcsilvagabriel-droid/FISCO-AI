// Persistência do log de eventos (append-only, com teto de retenção).
// Isolado do barramento: trocar por API/DB = trocar esta implementação.
import { logger } from "@/core/logger";
import { DomainEventSchema, type DomainEvent } from "./types";

const KEY = "plataforma:event-store";
const MAX = 2000;

function read(): DomainEvent[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((i) => {
      const p = DomainEventSchema.safeParse(i);
      return p.success ? [p.data] : [];
    });
  } catch {
    return [];
  }
}

function write(items: DomainEvent[]) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX)));
  } catch (err) {
    logger.warn("event-store", "falha ao persistir eventos", err);
  }
}

export const EventStore = {
  append(evento: DomainEvent): DomainEvent {
    const all = read();
    all.push(evento);
    write(all);
    return evento;
  },
  atualizar(id: string, patch: Partial<DomainEvent>): void {
    const all = read();
    const idx = all.findIndex((e) => e.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx]!, ...patch };
    write(all);
  },
  listar(filtro?: Partial<Pick<DomainEvent, "tipo" | "origem" | "status">>): DomainEvent[] {
    const all = read();
    if (!filtro) return all;
    return all.filter((e) =>
      (!filtro.tipo || e.tipo === filtro.tipo) &&
      (!filtro.origem || e.origem === filtro.origem) &&
      (!filtro.status || e.status === filtro.status));
  },
  porContexto(chave: keyof DomainEvent["contexto"], valor: string): DomainEvent[] {
    return read().filter((e) => e.contexto[chave] === valor);
  },
  limpar(): void { write([]); },
};
