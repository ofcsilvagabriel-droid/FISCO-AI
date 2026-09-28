import { RelatorioRepository } from "../repositories/RelatorioRepository";
import type { Relatorio } from "../entities/relatorio";
export const RelatorioService = {
  list: () => RelatorioRepository.getAll(),
  get: (id: string) => RelatorioRepository.findById(id),
  salvar: (r: Omit<Relatorio, "id" | "geradoEm"> & { id?: string; geradoEm?: string }) =>
    RelatorioRepository.upsert({
      ...r,
      id: r.id || crypto.randomUUID(),
      geradoEm: r.geradoEm || new Date().toISOString(),
    } as Relatorio),
};
