import { ApuracaoRepository } from "../repositories/ApuracaoRepository";
import type { Apuracao } from "../entities/apuracao";
export const ApuracaoService = {
  list: () => ApuracaoRepository.getAll(),
  porEmpresaCompetencia: (empresaId: string, competencia: string) =>
    ApuracaoRepository.query((a) => a.empresaId === empresaId && a.competencia === competencia)[0],
  save: (a: Apuracao) => ApuracaoRepository.upsert({
    ...a,
    id: a.id || `${a.empresaId}:${a.competencia}`,
    atualizadoEm: new Date().toISOString(),
  }),
};
