// Persistência da trilha, com teto de retenção e consulta por contexto.
import { LocalStorageRepository } from "@/modules/fiscal/domain/repositories/LocalStorageRepository";
import { TrilhaEventoSchema, type ContextoTrilha, type TrilhaEvento } from "../entities/TrilhaEvento";

const MAX = 3000;
const base = new LocalStorageRepository<TrilhaEvento>("plataforma:rastreabilidade", TrilhaEventoSchema);

export const TrilhaRepository = {
  registrar(evento: TrilhaEvento): TrilhaEvento {
    const salvo = base.upsert(evento);
    const todos = base.getAll();
    if (todos.length > MAX) todos.slice(0, todos.length - MAX).forEach((e) => base.remove(e.id));
    return salvo;
  },
  listar(): TrilhaEvento[] {
    return [...base.getAll()].sort((a, b) => b.data.localeCompare(a.data));
  },
  porContexto(chave: keyof ContextoTrilha, valor: string): TrilhaEvento[] {
    return TrilhaRepository.listar().filter((e) => e.contexto[chave] === valor);
  },
  limpar(): void { base.clear(); },
};
