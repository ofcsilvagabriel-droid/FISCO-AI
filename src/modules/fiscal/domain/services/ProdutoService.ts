import { ProdutoRepository } from "../repositories/ProdutoRepository";
import type { Produto } from "../entities/produto";

export const ProdutoService = {
  list: () => ProdutoRepository.getAll(),
  get: (id: string) => ProdutoRepository.findById(id),
  porNCM: (ncm: string) => ProdutoRepository.query((p) => p.ncm === ncm),
  save: (p: Produto) => ProdutoRepository.upsert({ ...p, id: p.id || crypto.randomUUID() }),
  remove: (id: string) => ProdutoRepository.remove(id),
};
