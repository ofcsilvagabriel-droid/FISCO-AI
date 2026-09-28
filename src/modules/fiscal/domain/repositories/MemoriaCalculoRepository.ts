import { LocalStorageRepository } from "./LocalStorageRepository";
import { MemoriaCalculoSchema, type MemoriaCalculoPorNCM } from "../entities/memoriaCalculo";

export const MemoriaCalculoRepository = new LocalStorageRepository<MemoriaCalculoPorNCM>(
  "fiscoai:memoria-calculo-ncm:v1",
  MemoriaCalculoSchema,
);
