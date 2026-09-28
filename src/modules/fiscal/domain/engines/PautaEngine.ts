// =====================================================================
// PAUTA ENGINE
// ---------------------------------------------------------------------
// Identifica se um cálculo foi feito por PAUTA (PMC/PMPF).
// Regra: produtos com pauta NUNCA usam memória de cálculo — cada
// ocorrência é recalculada conforme o PMC/PMPF informado na própria NF.
// =====================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */

export type PautaCheck = {
  temPauta: boolean;
  fontePauta: string | null;
  metodoPauta: string | null;
  valorPMC: number | null;
  descricaoProduto: string | null;
};

const RE_PMC = /PM(?:C|PF)\s*[:=]?\s*R?\$?\s*([0-9]{1,3}(?:[.\s][0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{1,4})?)/i;

function paraNumero(bruto: string): number | null {
  const n = String(bruto)
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const v = parseFloat(n);
  return isNaN(v) ? null : v;
}

/** Log técnico dedicado à memória/pauta. */
export function logTecnicoMemoria(msg: string) {
  try {
    // eslint-disable-next-line no-console
    console.info(msg);
  } catch {
    /* noop */
  }
}

/**
 * Identifica se o cálculo foi feito por pauta.
 * Critérios: flags de pauta no resultado do cálculo OU "PMC:"/"PMPF:"
 * no descritivo do produto.
 */
export function identificarSeTemPauta(
  calculo: Record<string, any> | null | undefined,
  descricaoProduto?: string | null,
): PautaCheck {
  const c = (calculo || {}) as Record<string, any>;
  const params = (c.parametros || {}) as Record<string, any>;

  const metodo = c.metodo_pauta || params.metodo_pauta || null;
  const fonte = c.fonte_pauta || params.fonte_pauta || null;
  const flag = c.pauta_aplicada ?? params.pauta_aplicada ?? null;
  const metodoValido = metodo && String(metodo).toUpperCase() !== "MVA";
  const flagValida = !!flag && String(flag).toUpperCase() !== "MVA";
  const tipoPauta = String(c.tipo_calculo || "").includes("PAUTA");

  if (metodoValido || flagValida || tipoPauta) {
    return {
      temPauta: true,
      fontePauta: fonte || (typeof flag === "string" ? flag : null),
      metodoPauta: metodo || (typeof flag === "string" ? flag : "PMC"),
      valorPMC: Number(c.valor_pmc || c.valor_pauta_unitario || params.valor_pmc || 0) || null,
      descricaoProduto: descricaoProduto || null,
    };
  }

  const match = String(descricaoProduto || "").match(RE_PMC);
  if (match) {
    const valorPMC = paraNumero(match[1]);
    if (valorPMC && valorPMC > 0) {
      return {
        temPauta: true,
        fontePauta: "DESCRICAO_PRODUTO",
        metodoPauta: /PMPF/i.test(match[0]) ? "PMPF" : "PMC",
        valorPMC,
        descricaoProduto: descricaoProduto || null,
      };
    }
  }

  return {
    temPauta: false,
    fontePauta: null,
    metodoPauta: null,
    valorPMC: null,
    descricaoProduto: descricaoProduto || null,
  };
}

/** Valida se a pauta identificada é aplicável. */
export function validarPauta(pauta: PautaCheck): { valida: boolean; motivo: string } {
  if (!pauta.temPauta) return { valida: false, motivo: "Nenhuma pauta detectada" };
  if (!pauta.valorPMC) return { valida: false, motivo: "PMC não encontrado na pauta" };
  return { valida: true, motivo: "Pauta PMC válida e aplicável" };
}
