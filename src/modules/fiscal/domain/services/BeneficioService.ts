import { BeneficioRepository } from "../repositories/BeneficioRepository";
export const BeneficioService = {
  conv5291PorNCM: (ncm: string) => BeneficioRepository.conv5291.porNCM(ncm),
  cargaEfetivaConv5291: (tipo: string, ufOrigem: string, ufDestino: string) =>
    BeneficioRepository.conv5291.cargaEfetiva(tipo, ufOrigem, ufDestino),
};
