// =====================================================================
// PMC NO DESCRITIVO DO PRODUTO
// ---------------------------------------------------------------------
// O cálculo por PAUTA (PMC/PMPF) só pode ser aplicado quando o próprio
// documento fiscal informa o preço — seja pela tag <vPMC>/<vPMpF> ou
// pelo descritivo/infAdProd no formato "PMC:206,08".
// Sem essa informação, a pauta é BLOQUEADA e o cálculo segue automático.
// =====================================================================

const RE_PMC = /PMC\s*[:=]?\s*R?\$?\s*([0-9]{1,3}(?:[.\s][0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{1,4})?)/i;
const RE_PMPF = /PMPF\s*[:=]?\s*R?\$?\s*([0-9]{1,3}(?:[.\s][0-9]{3})*,[0-9]{2}|[0-9]+(?:[.,][0-9]{1,4})?)/i;

function paraNumero(bruto) {
  const n = String(bruto)
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const v = parseFloat(n);
  return isNaN(v) ? null : v;
}

/**
 * Verifica se o descritivo do produto contém "PMC:" com valor.
 * @param {string} descricaoProduto texto do xProd + infAdProd
 */
export function verificarSeTemPMC(descricaoProduto) {
  const m = String(descricaoProduto || "").match(RE_PMC);
  const valor = m && m[1] ? paraNumero(m[1]) : null;
  if (valor && valor > 0) {
    return { temPMC: true, valorPMC: valor, encontradoEm: m[0].trim() };
  }
  return { temPMC: false, valorPMC: null, encontradoEm: null };
}

/** Mesma verificação para PMPF informado no descritivo. */
export function verificarSeTemPMPF(descricaoProduto) {
  const m = String(descricaoProduto || "").match(RE_PMPF);
  const valor = m && m[1] ? paraNumero(m[1]) : null;
  if (valor && valor > 0) {
    return { temPMPF: true, valorPMPF: valor, encontradoEm: m[0].trim() };
  }
  return { temPMPF: false, valorPMPF: null, encontradoEm: null };
}

/**
 * Regra de admissão da pauta para um produto já parseado da NF-e.
 * Aceita apenas preço vindo do documento fiscal (tag ou descritivo).
 * @returns {{admitida:boolean, origem:"tag"|"descricao"|null, tipo:"PMC"|"PMPF"|null,
 *            valor:number, encontradoEm:string|null, motivo:string}}
 */
export function admitePauta(produto = {}) {
  const texto = `${produto.descricao || ""} ${produto.info_adicional || ""}`;
  const pmcDesc = verificarSeTemPMC(texto);
  const pmpfDesc = verificarSeTemPMPF(texto);
  const tagPMC = produto.pmc_origem === "tag" && Number(produto.vPMC) > 0;
  const tagPMPF = Number(produto.pmpf) > 0 && !pmpfDesc.temPMPF && produto.pmpf_origem === "tag";

  if (tagPMC) {
    return { admitida: true, origem: "tag", tipo: "PMC", valor: Number(produto.vPMC), encontradoEm: "<vPMC>", motivo: "PMC informado na tag <vPMC> da NF-e." };
  }
  if (pmcDesc.temPMC) {
    return { admitida: true, origem: "descricao", tipo: "PMC", valor: pmcDesc.valorPMC, encontradoEm: pmcDesc.encontradoEm, motivo: `PMC localizado no descritivo (${pmcDesc.encontradoEm}).` };
  }
  if (tagPMPF) {
    return { admitida: true, origem: "tag", tipo: "PMPF", valor: Number(produto.pmpf), encontradoEm: "<vPMpF>", motivo: "PMPF informado na tag da NF-e." };
  }
  if (pmpfDesc.temPMPF) {
    return { admitida: true, origem: "descricao", tipo: "PMPF", valor: pmpfDesc.valorPMPF, encontradoEm: pmpfDesc.encontradoEm, motivo: `PMPF localizado no descritivo (${pmpfDesc.encontradoEm}).` };
  }
  return {
    admitida: false,
    origem: null,
    tipo: null,
    valor: 0,
    encontradoEm: null,
    motivo: 'Produto sem "PMC:" (nem PMPF) no descritivo ou nas tags da NF-e — cálculo por pauta bloqueado.',
  };
}
