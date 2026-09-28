import { STORAGE_KEYS } from "@/core/constants";
import { LocalStorageRepository } from "./LocalStorageRepository";
import { EmpresaSchema, type Empresa } from "../entities/empresa";

export const EmpresaRepository = new LocalStorageRepository<Empresa>(STORAGE_KEYS.EMPRESAS, EmpresaSchema);
