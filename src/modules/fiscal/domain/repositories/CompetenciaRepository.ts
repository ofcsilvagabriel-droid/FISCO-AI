import { STORAGE_KEYS } from "@/core/constants";
import { LocalStorageRepository } from "./LocalStorageRepository";
import { CompetenciaSchema, type Competencia } from "../entities/competencia";

export const CompetenciaRepository = new LocalStorageRepository<Competencia>(STORAGE_KEYS.COMPETENCIA, CompetenciaSchema);
