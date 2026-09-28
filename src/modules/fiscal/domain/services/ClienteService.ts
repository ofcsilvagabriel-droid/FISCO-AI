import { ClienteRepository } from "../repositories/ClienteRepository";
import type { Cliente } from "../entities/cliente";
export const ClienteService = {
  list: () => ClienteRepository.getAll(),
  get: (id: string) => ClienteRepository.findById(id),
  save: (c: Cliente) => ClienteRepository.upsert({ ...c, id: c.id || (c.cnpjCpf || crypto.randomUUID()) }),
  remove: (id: string) => ClienteRepository.remove(id),
};
