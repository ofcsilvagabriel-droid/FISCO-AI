export const INTERVALO_MINIMO_BUSCA_DFE_MS = 2 * 60 * 60 * 1000;
const NSU_INICIAL = "000000000000000";

function nsuValido(nsu: unknown): nsu is string {
  return typeof nsu === "string" && /^[0-9]{15}$/.test(nsu);
}

export function existeLoteDfePendente(cursor: { ult_nsu?: string | null; max_nsu?: string | null } | null | undefined): boolean {
  const ultNsu = String(cursor?.ult_nsu || "").padStart(15, "0");
  const maxNsu = String(cursor?.max_nsu || "").padStart(15, "0");
  return /^\d{15}$/.test(ultNsu) && /^\d{15}$/.test(maxNsu) && ultNsu < maxNsu;
}

export function resolverCursoresDfe(
  cursor: { ult_nsu?: string | null; max_nsu?: string | null },
  retorno: { ultNsu?: string | null; maxNsu?: string | null },
) {
  const ultAtual = nsuValido(cursor.ult_nsu) ? cursor.ult_nsu : NSU_INICIAL;
  const maxAtual = nsuValido(cursor.max_nsu) ? cursor.max_nsu : ultAtual;
  const ultRetornado = nsuValido(retorno.ultNsu) ? retorno.ultNsu : ultAtual;
  const maxRetornado = nsuValido(retorno.maxNsu) ? retorno.maxNsu : maxAtual;
  const ultNsu = ultRetornado >= ultAtual ? ultRetornado : ultAtual;
  const maxNsu = maxRetornado >= ultNsu ? maxRetornado : ultNsu;
  return { ultNsu, maxNsu };
}
