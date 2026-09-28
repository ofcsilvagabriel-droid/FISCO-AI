import { STORAGE_KEYS } from "@/core/constants";
import { LocalStorageRepository } from "./LocalStorageRepository";
import { RelatorioSchema, type Relatorio } from "../entities/relatorio";

export const RelatorioRepository = new LocalStorageRepository<Relatorio>(STORAGE_KEYS.RELATORIOS, RelatorioSchema);
