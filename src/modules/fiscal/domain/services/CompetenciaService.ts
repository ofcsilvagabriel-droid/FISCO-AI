import { CompetenciaRepository } from "../repositories/CompetenciaRepository";
import { parseCompetencia, type Competencia } from "../entities/competencia";
export const CompetenciaService = {
  list: () => CompetenciaRepository.getAll(),
  get: (yyyyMm: string) => CompetenciaRepository.findById(yyyyMm),
  abrir: (yyyyMm: string): Competencia => CompetenciaRepository.upsert(parseCompetencia(yyyyMm)),
  fechar: (yyyyMm: string): Competencia | undefined => {
    const c = CompetenciaRepository.findById(yyyyMm);
    if (!c) return undefined;
    return CompetenciaRepository.upsert({ ...c, status: "fechada" });
  },
};
