export const INTERVALO_MINIMO_BUSCA_DFE_MS = 2 * 60 * 60 * 1000;

export function existeLoteDfePendente(cursor: { ult_nsu?: string | null; max_nsu?: string | null } | null | undefined): boolean {
  const ultNsu = String(cursor?.ult_nsu || "").padStart(15, "0");
  const maxNsu = String(cursor?.max_nsu || "").padStart(15, "0");
  return /^\d{15}$/.test(ultNsu) && /^\d{15}$/.test(maxNsu) && ultNsu < maxNsu;
}
