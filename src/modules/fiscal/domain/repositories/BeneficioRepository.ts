// Repositório read-only de benefícios fiscais oficiais (Conv. 52/91).
import { Conv5291Repository } from "./Conv5291Repository";

export const BeneficioRepository = {
  conv5291: {
    porNCM: (ncm: string) => Conv5291Repository.identificar(ncm),
    cargaEfetiva: (tipo: string, ufOrigem: string, ufDestino: string) =>
      Conv5291Repository.cargaEfetiva(tipo, ufOrigem, ufDestino),
  },
};
