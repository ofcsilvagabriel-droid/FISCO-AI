import { STORAGE_KEYS } from "@/core/constants";
import { LocalStorageRepository } from "./LocalStorageRepository";
import { ApuracaoSchema, type Apuracao } from "../entities/apuracao";

export const ApuracaoRepository = new LocalStorageRepository<Apuracao>(STORAGE_KEYS.APURACAO, ApuracaoSchema);
