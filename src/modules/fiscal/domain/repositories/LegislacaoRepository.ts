// Repositório read-only agregando as fontes oficiais de legislação.
// Fonte dos dados: RicmsBaRepository + Conv5291Repository.
import { RicmsBaRepository } from "./RicmsBaRepository";
import { Conv5291Repository } from "./Conv5291Repository";

const digs = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export const LegislacaoRepository = {
  ricmsAll: () => RicmsBaRepository.all(),
  ricmsPorNCM: (ncm: string) => RicmsBaRepository.buscarPorNCM(digs(ncm)),
  ricmsPorCEST: (cest: string) => RicmsBaRepository.buscarPorCEST(digs(cest)),
  convenio5291PorNCM: (ncm: string) => Conv5291Repository.identificar(digs(ncm)),
};
