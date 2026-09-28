// CEST — validador. Nunca pontua e nunca é requisito obrigatório.
export const CestValidator = {
  /**
   * @returns true = confirma, false = diverge, null = não avaliável
   */
  conferir(cestProduto: unknown, cestNorma: unknown): boolean | null {
    const a = String(cestProduto ?? "").replace(/\D/g, "");
    const b = String(cestNorma ?? "").replace(/\D/g, "");
    if (!a || !b) return null;
    if (a === b) return true;
    // mesmo segmento + item CEST (5 primeiros dígitos) ainda confirma
    if (a.slice(0, 5) === b.slice(0, 5)) return true;
    return false;
  },

  segmentoCEST(cest: unknown): string {
    return String(cest ?? "").replace(/\D/g, "").slice(0, 2);
  },
};
