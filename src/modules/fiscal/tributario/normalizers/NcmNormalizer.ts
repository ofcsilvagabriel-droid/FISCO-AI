// Normalizer de NCM — hierarquia da NCM/SH, sem regra tributária.
import type { NivelNCM } from "../types";

export const NcmNormalizer = {
  digitos(valor: unknown): string {
    return String(valor ?? "").replace(/\D/g, "").slice(0, 8);
  },

  completar8(valor: unknown): string {
    const d = NcmNormalizer.digitos(valor);
    return d.length === 8 ? d : d;
  },

  nivel(valor: unknown): NivelNCM {
    const n = NcmNormalizer.digitos(valor).length;
    if (n >= 8) return "ITEM";
    if (n >= 6) return "SUBPOSICAO";
    if (n >= 4) return "POSICAO";
    if (n >= 2) return "CAPITULO";
    return "NENHUM";
  },

  capitulo(valor: unknown): string {
    return NcmNormalizer.digitos(valor).slice(0, 2);
  },

  posicao(valor: unknown): string {
    return NcmNormalizer.digitos(valor).slice(0, 4);
  },

  subposicao(valor: unknown): string {
    return NcmNormalizer.digitos(valor).slice(0, 6);
  },

  /** família tributária = posição (4 díg.); fallback capítulo */
  familia(valor: unknown): string {
    const p = NcmNormalizer.posicao(valor);
    return p.length === 4 ? p : NcmNormalizer.capitulo(valor);
  },

  /** extrai todos os NCMs citados num texto legal ("2201.1 e 2201.9") */
  extrairDeTexto(texto: unknown): string[] {
    const t = String(texto ?? "");
    const achados = t.match(/\b\d{4}(?:\.\d{1,2}){0,3}\b/g) || [];
    const set = new Set<string>();
    for (const a of achados) {
      const d = NcmNormalizer.digitos(a);
      if (d.length >= 4) set.add(d);
    }
    return [...set];
  },
};
