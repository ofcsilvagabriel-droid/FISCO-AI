import { LocalStorageRepository } from "./LocalStorageRepository";
import { FornecedorSchema, type Fornecedor } from "../entities/fornecedor";

export const FornecedorRepository = new LocalStorageRepository<Fornecedor>("fiscoai:fornecedores:v1", FornecedorSchema);
