const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

export const REDUCAO_ANTECIPACAO_PCT = 20;
export const arredondarCentavos = (valor) => Math.round((numero(valor) + Number.EPSILON) * 100) / 100;

export function totaisAntecipacao(calculos = []) {
  const itens = (Array.isArray(calculos) ? calculos : []).filter(item => item?.tributacao === "ANTECIPACAO");
  const bruto = arredondarCentavos(itens.reduce((soma, item) => soma + numero(item?.valor_icms_st), 0));
  const comReducao = arredondarCentavos(itens.reduce(
    (soma, item) => soma + arredondarCentavos(numero(item?.valor_icms_st) * (1 - REDUCAO_ANTECIPACAO_PCT / 100)),
    0,
  ));
  return { bruto, comReducao, reducaoPct: itens.length ? REDUCAO_ANTECIPACAO_PCT : 0 };
}

/** Aplica somente valores editáveis; o produto original permanece imutável. */
export function aplicarOverrides(produto, override = {}) {
  const permitido = [
    "valor_total", "valor_frete", "valor_seguro", "valor_outras_desp", "valor_desconto",
    "quantidade", "valor_unitario", "aliquota_icms", "mva_informada", "fcp_percentual",
    "remover_reducoes",
  ];
  const aplicado = {};
  permitido.forEach((campo) => {
    if (Object.prototype.hasOwnProperty.call(override, campo)) aplicado[campo] = override[campo];
  });
  return { ...produto, ...aplicado };
}

/** Rateia um valor de cabeçalho por valor de produto, com o último item absorvendo centavos. */
export function ratearPorValorProdutos(produtos = [], valor = 0) {
  const totalProdutos = produtos.reduce((s, produto) => s + Math.max(0, numero(produto?.valor_total)), 0);
  const total = arredondarCentavos(valor);
  if (!produtos.length || !totalProdutos) return produtos.map(() => 0);
  let acumulado = 0;
  return produtos.map((produto, indice) => {
    if (indice === produtos.length - 1) return arredondarCentavos(total - acumulado);
    const parcela = arredondarCentavos(total * Math.max(0, numero(produto?.valor_total)) / totalProdutos);
    acumulado = arredondarCentavos(acumulado + parcela);
    return parcela;
  });
}
