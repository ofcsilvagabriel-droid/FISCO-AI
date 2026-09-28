/**
 * Convênio ICMS 142/18 — Autopeças
 *
 * Referência: Art. 2º e Anexos (relação de autopeças / MVAs) do Conv. ICMS 142/18.
 *
 * Usado apenas como FALLBACK: o Anexo 1 do RICMS/BA tem PRIORIDADE.
 * MVAs padrão: 42% (operação interna BA) e 40% (aquisições interestaduais).
 */

export const CONV_142_18 = {
  numero: "142/18",
  signatarios: [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
    "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
    "RS", "RO", "RR", "SC", "SP", "SE", "TO",
  ],
  // UF → lista de NCM (prefixos) excluídos pela própria UF
  exclusoes_estaduais: {},

  mva_padrao_interno_ba: 0.42,
  mva_padrao_aquisicoes: 0.40,

  /** NCM cobertos (prefixo → descrição) */
  ncm_cobertos: {
    "87": "Veículos e suas partes (capítulo 87)",
    "3916.90.00": "Plásticos — monofilamentos, barras, bastonetes — outras formas",
    "4016": "Borracha vulcanizada — artigos diversos (mangueiras, selos)",
    "7007": "Vidros de segurança — temperado ou laminado",
    "7009": "Espelhos de vidro",
    "8421": "Máquinas, aparelhos e unidades de filtragem",
    "8507": "Baterias e acumuladores",
    "8544": "Fios e cabos isolados",
    "2710": "Óleos de petróleo — lubrificantes",
    "3208": "Tintas e vernizes",
    "3209": "Tintas de secagem rápida (lacas)",
  },

  /** Verifica se o NCM é autopeça coberta pelo Convênio 142/18. */
  isAutopeca(ncm) {
    const nStr = String(ncm || "").replace(/\D/g, "");
    if (!nStr) return false;
    if (nStr.startsWith("87")) return true;
    for (const pos of Object.keys(this.ncm_cobertos)) {
      if (pos === "87") continue;
      const p = pos.replace(/\D/g, "");
      if (p && nStr.startsWith(p)) return true;
    }
    return false;
  },

  /** Verifica se a UF é signatária do convênio. */
  isSignataria(uf) {
    return this.signatarios.includes(String(uf || "").toUpperCase());
  },

  /** Verifica se a UF de destino excluiu o NCM. */
  temExclusao(uf, ncm) {
    const lista = this.exclusoes_estaduais[String(uf || "").toUpperCase()] || [];
    const nStr = String(ncm || "").replace(/\D/g, "");
    return lista.some((p) => nStr.startsWith(String(p).replace(/\D/g, "")));
  },

  /** MVA original em decimal (0.42 / 0.40). */
  obterMVA(operacao = "interestadual") {
    if (operacao === "interno" || operacao === "intra") return this.mva_padrao_interno_ba;
    return this.mva_padrao_aquisicoes;
  },
};

export default CONV_142_18;
