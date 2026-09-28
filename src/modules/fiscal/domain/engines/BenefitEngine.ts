// Engine de Benefícios Fiscais — Convênios (52/91, 101/97, 142/18)
// e reduções de base. Fachada sobre motorConvenio + Conv5291Repository.
import { isRegraConvenio, matchConvenioEstrito } from "../../engines/motorConvenio";
import { Conv5291Repository } from "../repositories/Conv5291Repository";

export const BenefitEngine = {
  isConvenio: (regra: unknown) => isRegraConvenio(regra as never),
  matchConvenio: (produto: unknown, regra: unknown) =>
    matchConvenioEstrito(produto as never, regra as never),
  conv5291: {
    identificar: Conv5291Repository.identificar,
    beneficio: Conv5291Repository.beneficio,
    cargaEfetiva: Conv5291Repository.cargaEfetiva,
  },
};
