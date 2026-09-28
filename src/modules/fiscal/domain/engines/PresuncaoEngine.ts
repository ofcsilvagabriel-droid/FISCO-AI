// Engine de Presunção — calcula o ICMS próprio quando não vem destacado na NF.
// Presunção = Valor Total × Alíquota Interestadual / 100
import { CalculationEngine } from "./CalculationEngine";

export type PresuncaoInput = {
  valorTotal: number;
  ufOrigem: string;
  ufDestino: string;
  icmsDestacadoNF: number | null | undefined;
  forcaPresuncao?: boolean;
};

export type PresuncaoResult = {
  temPresuncao: boolean;
  aliquotaUsada: number;
  valorICMSPresumido: number;
  baseCalculo: number;
  motivo: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Avalia se deve aplicar presunção de ICMS próprio. */
export function avaliarPresuncao(input: PresuncaoInput): PresuncaoResult {
  const { valorTotal, ufOrigem, ufDestino, icmsDestacadoNF, forcaPresuncao } = input;

  const temICMSDestacado =
    icmsDestacadoNF !== null && icmsDestacadoNF !== undefined && Number(icmsDestacadoNF) > 0;

  if (temICMSDestacado && !forcaPresuncao) {
    return {
      temPresuncao: false,
      aliquotaUsada: 0,
      valorICMSPresumido: 0,
      baseCalculo: 0,
      motivo: `ICMS destacado na NF: R$ ${Number(icmsDestacadoNF).toFixed(2)}. Presunção não aplicada.`,
    };
  }

  if (!(Number(valorTotal) > 0)) {
    return {
      temPresuncao: false,
      aliquotaUsada: 0,
      valorICMSPresumido: 0,
      baseCalculo: 0,
      motivo: "Valor total do item indisponível. Presunção não aplicada.",
    };
  }

  let aliquota = 0;
  try {
    aliquota = Number(CalculationEngine.aliquotaInterestadual(ufOrigem, ufDestino)) || 0;
  } catch {
    aliquota = 0;
  }

  if (!aliquota || aliquota <= 0) {
    return {
      temPresuncao: false,
      aliquotaUsada: 0,
      valorICMSPresumido: 0,
      baseCalculo: 0,
      motivo: `Alíquota interestadual não encontrada para ${ufOrigem || "?"}→${ufDestino || "?"}. Presunção não aplicada.`,
    };
  }

  const baseCalculo = Number(valorTotal) || 0;
  const valorICMSPresumido = r2((baseCalculo * aliquota) / 100);

  return {
    temPresuncao: true,
    aliquotaUsada: aliquota,
    valorICMSPresumido,
    baseCalculo,
    motivo: `[PRESUNCAO] Presunção de crédito: alíquota interestadual ${ufOrigem || "?"}→${ufDestino || "?"} = ${aliquota}%. Valor presumido: R$ ${valorICMSPresumido.toFixed(2)}`,
  };
}

/** Aplica a presunção a um objeto de cálculo já montado. */
export function aplicarPresuncaoAoCalculo(
  calculoAtual: Record<string, any>,
  presuncao: PresuncaoResult,
): Record<string, any> {
  if (!presuncao.temPresuncao) return calculoAtual;

  return {
    ...calculoAtual,
    valor_icms: presuncao.valorICMSPresumido,
    valor_icms_proprio: presuncao.valorICMSPresumido,
    base_icms: presuncao.baseCalculo || calculoAtual.base_icms || calculoAtual.valor_total || 0,
    base_icms_presumida: presuncao.baseCalculo || calculoAtual.base_icms || calculoAtual.valor_total || 0,
    aliquota_aplicada: presuncao.aliquotaUsada,
    aliquota_presumida: presuncao.aliquotaUsada,
    icms_foi_presumido: true,
    icms_proprio_presumido: true,
    presuncao_credito: true,
    presuncao_credito_aliq: presuncao.aliquotaUsada,
    fundamento: presuncao.motivo,
    obs: `${calculoAtual.obs || ""} [PRESUNÇÃO DE CRÉDITO] ${presuncao.motivo}`.trim(),
  };
}

/** Valida coerência da presunção aplicada. */
export function validarPresuncao(calculo: Record<string, any>): {
  valido: boolean;
  avisos: string[];
} {
  const avisos: string[] = [];
  if (!calculo?.icms_proprio_presumido) return { valido: true, avisos };

  const icms = Number(calculo.valor_icms_proprio ?? calculo.valor_icms) || 0;
  const total = Number(calculo.valor_total ?? calculo.base_calc ?? calculo.base_icms) || 0;
  if (icms > 0 && total > 0) {
    const pct = (icms / total) * 100;
    if (pct < 5) {
      avisos.push(
        `⚠️ Presunção de ICMS baixa: ${pct.toFixed(2)}% do valor total. Verificar alíquota interestadual.`,
      );
    }
    if (pct > 30) {
      avisos.push(
        `⚠️ Presunção de ICMS alta: ${pct.toFixed(2)}% do valor total. Verificar alíquota interestadual.`,
      );
    }
  }
  return { valido: true, avisos };
}

export const PresuncaoEngine = { avaliarPresuncao, aplicarPresuncaoAoCalculo, validarPresuncao };
