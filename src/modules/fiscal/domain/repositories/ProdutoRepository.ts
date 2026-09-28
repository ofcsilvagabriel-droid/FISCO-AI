import { LocalStorageRepository } from "./LocalStorageRepository";
import { ProdutoSchema, type Produto } from "../entities/produto";

export const ProdutoRepository = new LocalStorageRepository<Produto>("fiscoai:produtos:v1", ProdutoSchema);
