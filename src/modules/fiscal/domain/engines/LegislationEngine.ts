// Engine de Legislação — consultas por NCM/CEST agregando as fontes
// oficiais (RICMS/BA, Convênio 52/91). Não decide enquadramento;
// apenas devolve as regras encontradas para exibição/consulta.
import { RicmsBaRepository } from "../repositories/RicmsBaRepository";
import { Conv5291Repository } from "../repositories/Conv5291Repository";

const digs = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export const LegislationEngine = {
  consultarPorNCM(ncm: string) {
    const n = digs(ncm);
    const ricms = RicmsBaRepository.buscarPorNCM(n);
    const conv52 = Conv5291Repository.identificar(n);
    return { ricms, conv5291: conv52 };
  },
  consultarPorCEST(cest: string) {
    return { ricms: RicmsBaRepository.buscarPorCEST(cest) };
  },
};
