import { FornecedorRepository } from "../repositories/FornecedorRepository";
import type { Fornecedor } from "../entities/fornecedor";
export const FornecedorService = {
  list: () => FornecedorRepository.getAll(),
  get: (id: string) => FornecedorRepository.findById(id),
  save: (f: Fornecedor) => FornecedorRepository.upsert({ ...f, id: f.id || (f.cnpj || crypto.randomUUID()) }),
  remove: (id: string) => FornecedorRepository.remove(id),
};
