// Repositório: tabelas de alíquotas ICMS por UF e helpers DIFAL.
import {
  ALIQ_INTERNA_UF,
  buscarAliquotaInterestadual,
  buscarAliquotaInterna,
  isImportadoPorCSTOrig,
  calcularDIFAL,
} from "../../data/aliquotasUF";

export const AliquotasRepository = {
  interna: (uf: string) => buscarAliquotaInterna(uf),
  interestadual: (ufOrigem: string, ufDestino: string, importado = false) =>
    buscarAliquotaInterestadual(ufOrigem, ufDestino, importado),
  isImportado: (origCode: string) => isImportadoPorCSTOrig(origCode),
  tabelaInterna: () => ALIQ_INTERNA_UF,
  difal: (nota: unknown) => calcularDIFAL(nota as never),
};
