// Fonte única de verdade do ICMS PRÓPRIO da operação.
//
// Hierarquia da alíquota:
//   1. Alíquota válida informada no XML
//   2. Alíquota presumida pelo motor tributário (ex.: interestadual)
//   3. Nenhuma alíquota → NAO_DETERMINADA (não inventa alíquota)
//
// Regra de cálculo: ICMS = Base de Cálculo × Alíquota / 100
// Operações isentas / não incidentes / sem tributação NÃO geram ICMS,
// mesmo havendo alíquota presumida disponível.

export type OrigemAliquotaICMS = "XML" | "PRESUMIDA" | "NAO_DETERMINADA";
export type SituacaoTributariaICMS =
  | "TRIBUTADA"
  | "ISENTA"
  | "NAO_INCIDENCIA"
  | "SEM_TRIBUTACAO";

export type IcmsProprioInput = {
  /** vICMS do XML (valor original, preservado para auditoria) */
  valorIcmsXml?: number | null;
  /** vBC do XML */
  baseIcmsXml?: number | null;
  /** pICMS do XML */
  aliquotaXml?: number | null;
  /** valor total do item (fallback de base, regra já existente no sistema) */
  valorTotal?: number | null;
  /** alíquota presumida pelo motor (interestadual/interna) */
  aliquotaPresumida?: number | null;
  /** situação tributária determinada pela classificação (CST/CFOP/gate) */
  situacao?: SituacaoTributariaICMS;
};

export type IcmsProprioResult = {
  situacao_tributaria_icms: SituacaoTributariaICMS;
  base_calculo_icms: number;
  aliquota_icms_utilizada: number;
  origem_aliquota_icms: OrigemAliquotaICMS;
  icms_proprio_calculado: number;
  /** valor bruto recebido do XML — nunca sobrescrito */
  valor_icms_xml: number;
  presumido: boolean;
  logs: string[];
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n: unknown) => (Number(n) > 0 ? Number(n) : 0);

export function resolverIcmsProprio(input: IcmsProprioInput): IcmsProprioResult {
  const situacao = input.situacao ?? "TRIBUTADA";
  const valorIcmsXml = num(input.valorIcmsXml);
  const baseXml = num(input.baseIcmsXml);
  const valorTotal = num(input.valorTotal);
  const aliqXml = num(input.aliquotaXml);
  const aliqPresumida = num(input.aliquotaPresumida);
  const logs: string[] = [];

  const vazio = (
    origem: OrigemAliquotaICMS,
    aliquota: number,
    base: number,
  ): IcmsProprioResult => ({
    situacao_tributaria_icms: situacao,
    base_calculo_icms: base,
    aliquota_icms_utilizada: aliquota,
    origem_aliquota_icms: origem,
    icms_proprio_calculado: 0,
    valor_icms_xml: valorIcmsXml,
    presumido: false,
    logs,
  });

  if (situacao !== "TRIBUTADA") {
    logs.push(
      `[ICMS_SEM_INCIDENCIA] Situação tributária ${situacao}: alíquota presumida desconsiderada, ICMS próprio = R$ 0,00.`,
    );
    return vazio("NAO_DETERMINADA", 0, 0);
  }

  // Base: vBC do XML; na ausência, valor total do item (regra já existente).
  const base = baseXml > 0 ? baseXml : valorTotal;
  if (!(base > 0)) {
    logs.push("[ICMS_SEM_BASE] Base de cálculo do ICMS igual a zero. ICMS próprio não calculado.");
    return vazio(aliqXml > 0 ? "XML" : aliqPresumida > 0 ? "PRESUMIDA" : "NAO_DETERMINADA", aliqXml || aliqPresumida, 0);
  }

  let aliquota = 0;
  let origem: OrigemAliquotaICMS = "NAO_DETERMINADA";
  if (aliqXml > 0) {
    aliquota = aliqXml;
    origem = "XML";
  } else if (valorIcmsXml > 0) {
    // ICMS destacado sem pICMS: o próprio destaque é a verdade do XML.
    aliquota = r2((valorIcmsXml / base) * 100);
    origem = "XML";
  } else if (aliqPresumida > 0) {
    aliquota = aliqPresumida;
    origem = "PRESUMIDA";
  }


  if (origem === "NAO_DETERMINADA") {
    // sem alíquota: preserva o que veio do XML (se houver) sem inventar alíquota
    logs.push(
      "[ICMS_ALIQUOTA_NAO_DETERMINADA] Nenhuma alíquota válida (XML ou presumida). Operação pendente de análise.",
    );
    return {
      ...vazio("NAO_DETERMINADA", 0, base),
      icms_proprio_calculado: valorIcmsXml,
    };
  }

  const calculado = r2((base * aliquota) / 100);

  if (origem === "XML") {
    // Alíquota do XML: usa o vICMS destacado quando existir (evita divergência
    // de centavos com o documento); se vier zerado, calcula pela alíquota.
    const valor = valorIcmsXml > 0 ? r2(valorIcmsXml) : calculado;
    logs.push(
      valorIcmsXml > 0
        ? `[ICMS_DESTACADO] Usando valor da NF: R$ ${valor.toFixed(2)} (alíquota XML ${aliquota}%).`
        : `[ICMS_CALCULADO_XML] vICMS zerado no XML. Alíquota ${aliquota}% × Base R$ ${base.toFixed(2)} = R$ ${valor.toFixed(2)}.`,
    );
    return {
      situacao_tributaria_icms: situacao,
      base_calculo_icms: base,
      aliquota_icms_utilizada: aliquota,
      origem_aliquota_icms: "XML",
      icms_proprio_calculado: valor,
      valor_icms_xml: valorIcmsXml,
      presumido: false,
      logs,
    };
  }

  logs.push(
    `[ICMS_PRESUMIDO] Alíquota presumida ${aliquota}% × Base R$ ${base.toFixed(2)} = R$ ${calculado.toFixed(2)}.`,
  );
  logs.push(
    `[ICMS_CONSOLIDADO] Sem alíquota válida no XML: valor presumido tratado como ICMS destacado/próprio da operação.`,
  );
  return {
    situacao_tributaria_icms: situacao,
    base_calculo_icms: base,
    aliquota_icms_utilizada: aliquota,
    origem_aliquota_icms: "PRESUMIDA",
    icms_proprio_calculado: calculado,
    valor_icms_xml: valorIcmsXml,
    presumido: true,
    logs,
  };
}

export const IcmsProprioEngine = { resolverIcmsProprio };
