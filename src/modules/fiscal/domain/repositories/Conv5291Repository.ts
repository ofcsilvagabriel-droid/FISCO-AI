// Repositório: acesso ao Convênio ICMS 52/91 (industrial + agrícola)
// e cálculo de benefício. Fachada sobre data/conv5291.js.
import {
  CONV_52_91_INDUSTRIAL,
  CONV_52_91_AGRICOLA,
  identificarConv5291,
  cargaEfetivaConv5291,
  beneficio5291,
} from "../../data/conv5291";

export const Conv5291Repository = {
  industrial: () => CONV_52_91_INDUSTRIAL,
  agricola: () => CONV_52_91_AGRICOLA,
  identificar: (ncm: string) => identificarConv5291(ncm),
  cargaEfetiva: (tipo: string, ufOrigem: string, ufDestino: string) =>
    cargaEfetivaConv5291(tipo, ufOrigem, ufDestino),
  beneficio: (
    ncm: string,
    ufOrigem: string,
    ufDestino: string,
    aliquotaInterna: number,
  ) => beneficio5291(ncm, ufOrigem, ufDestino, aliquotaInterna),
};
