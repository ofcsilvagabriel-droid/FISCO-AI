// =====================================================================
// Alíquotas ICMS — Interestadual (CF/Res. SF 22/89 + 13/12) e Interna
// =====================================================================
// Fontes: tabelas oficiais fornecidas pelo usuário.
// Internas atualizadas para 2024-2025.
// =====================================================================

export const ALIQ_INTERNA_UF = {
  AC:19, AL:19, AM:20, AP:18, BA:20.5, CE:20, DF:18, ES:17,
  GO:17, MA:20, MG:18, MS:17, MT:17, PA:19, PB:20, PR:19.5,
  PE:20.5, PI:21, RJ:20, RN:20, RS:17, RO:19, RR:17, SC:17,
  SP:18, SE:22, TO:20,
};

// Origens (Sul/Sudeste, exceto ES) que aplicam 7% quando o destino for N/NE/CO+ES
const SUL_SUDESTE_EX_ES = ["SP","RJ","MG","RS","SC","PR"];
// Destinos que recebem 7% nessa regra
const DESTINOS_7 = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MS","MT","PA","PB","PE","PI","RN","RO","RR","SE","TO"];

/**
 * Retorna a alíquota interestadual aplicável.
 * - Mercadoria importada (Res. SF 13/12 → CST origem 1,2,3,6,7,8): 4%
 * - Origem SP/RJ/MG/RS/SC/PR → destino N/NE/CO+ES: 7%
 * - Demais combinações entre UFs distintas: 12%
 * - Mesma UF: alíquota interna (não há operação interestadual)
 */
export function buscarAliquotaInterestadual(ufOrigem, ufDestino, importado = false) {
  const o = (ufOrigem || "").toUpperCase();
  const d = (ufDestino || "").toUpperCase();
  if (!o || !d) return 12;
  if (o === d) return ALIQ_INTERNA_UF[d] ?? 18;
  if (importado) return 4;
  if (SUL_SUDESTE_EX_ES.includes(o) && DESTINOS_7.includes(d)) return 7;
  return 12;
}

export function buscarAliquotaInterna(uf) {
  return ALIQ_INTERNA_UF[(uf || "").toUpperCase()] ?? 18;
}

/**
 * CST origem (campo <orig> do grupo ICMS) que caracterizam mercadoria
 * importada com conteúdo de importação superior a 40% — Res. SF 13/12.
 */
export function isImportadoPorCSTOrig(origCode) {
  const c = String(origCode || "").trim();
  return ["1","2","3","6","7","8"].includes(c);
}

/**
 * Cálculo do DIFAL (EC 87/2015) — fórmula "por dentro".
 * nota = { produto, frete, seguro, outras, ipi, ufOrigem, ufDestino, importado,
 *          icmsOrigemDestacado? (R$, vICMS do item — se presente substitui o cálculo) }
 * Retorno em REAIS.
 */
export function calcularDIFAL(nota) {
  const produto = Number(nota.produto || 0);
  const frete   = Number(nota.frete   || 0);
  const seguro  = Number(nota.seguro  || 0);
  const outras  = Number(nota.outras  || 0);
  const desconto = Number(nota.desconto || 0);

  // Lei Kandir (LC 87/96): IPI não integra a base de cálculo do ICMS.
  const valor = Math.max(0, produto + frete + seguro + outras - desconto);

  const aliqInterPct = buscarAliquotaInterestadual(nota.ufOrigem, nota.ufDestino, !!nota.importado);
  const aliqInternaPct = buscarAliquotaInterna(nota.ufDestino);
  const aliqInter   = aliqInterPct   / 100;
  const aliqInterna = aliqInternaPct / 100;

  // ICMS de origem: usa vICMS destacado quando informado; senão calcula
  const icmsOrigem = (nota.icmsOrigemDestacado != null && nota.icmsOrigemDestacado > 0)
    ? Number(nota.icmsOrigemDestacado)
    : valor * aliqInter;

  // Base do DIFAL "por dentro"
  const baseDifal = (valor * (1 - aliqInter)) / (1 - aliqInterna);
  const icmsDestino = baseDifal * aliqInterna;
  const difal = icmsDestino - icmsOrigem;

  return {
    valor_operacao: valor,
    aliq_interestadual: aliqInterPct,
    aliq_interna: aliqInternaPct,
    base_calculo: baseDifal,
    icms_origem: icmsOrigem,
    icms_destino: icmsDestino,
    difal,
    icms_origem_fonte: (nota.icmsOrigemDestacado != null && nota.icmsOrigemDestacado > 0) ? "NF" : "TABELA",
  };
}
