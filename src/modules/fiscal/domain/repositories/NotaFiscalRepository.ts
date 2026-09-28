import { STORAGE_KEYS } from "@/core/constants";
import { LocalStorageRepository } from "./LocalStorageRepository";
import { NotaFiscalSchema, type NotaFiscal } from "../entities/notaFiscal";

export const NotaFiscalRepository = new LocalStorageRepository<NotaFiscal>(STORAGE_KEYS.NOTAS, NotaFiscalSchema);
