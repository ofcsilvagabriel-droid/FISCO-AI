import { describe, expect, it } from "vitest";
import { calcularICMSProduto } from "../FiscoAI";

const item = (campos = {}) => ({
  __simulacao: true,
  seq: "1",
  ncm: "82073000",
  descricao: "Ferramenta industrial",
  cst: "00",
  cfop: "6102",
  valor_total: 100,
  base_icms: 100,
  aliquota_icms: 7,
  valor_icms: 7,
  analise: [],
  ...campos,
});

describe("redução por item no cálculo da nota", () => {
  it("não reduz duas vezes a base da origem com CST 20", () => {
    const calc = calcularICMSProduto(
      item({ cst: "20", base_icms: 50, reducao_bc_xml: 50, valor_icms: 3.5 }),
      "SP",
      "BA",
    );
    expect(calc.tributacao).toBe("ANTECIPACAO");
    expect(calc.beneficio_5291?.anexo).toBe("I");
    expect(calc.base_st).toBeCloseTo(100 * (5.14 / 20.5), 4);
  });

  it("aplica redução só ao item elegível de nota mista, considerando frete e desconto", () => {
    const reduzido = calcularICMSProduto(item({ valor_frete: 10, valor_desconto: 5 }), "SP", "BA");
    const comum = calcularICMSProduto(
      item({ seq: "2", ncm: "99999999", valor_frete: 10, valor_desconto: 5 }),
      "SP",
      "BA",
    );
    expect(reduzido.base_st).toBeCloseTo(105 * (5.14 / 20.5), 4);
    expect(comum.beneficio_5291).toBeNull();
    expect(comum.base_st).toBe(105);
  });

  it("recalcula explicitamente o Convênio sem depender da análise antiga", () => {
    const calc = calcularICMSProduto(
      item({
        ncm: "87019200",
        descricao: "Trator agrícola de rodas",
        analise: [],
        decisao_manual: { modo: "CONVENIO_52_91" },
      }),
      "GO",
      "BA",
    );
    expect(calc.beneficio_5291?.anexo).toBe("II");
    expect(calc.beneficio_5291?.carga_efetiva).toBe(7);
    expect(calc.base_st).toBeCloseTo(100 * (7 / 20.5), 4);
  });

  it("combina ST e redução no mesmo item, sem substituir o regime por REDUCAO_BC", () => {
    const calc = calcularICMSProduto(
      item({
        cst: "10",
        cfop: "6102",
        cest: "0100100",
        analise: [{ tipo: "ICMS_ST", fundamento: "ST aplicável", mva_original: "40%" }],
      }),
      "SP",
      "BA",
    );
    expect(calc.tributacao).toBe("ICMS_ST");
    expect(calc.beneficio_5291?.anexo).toBe("I");
    expect(calc.base_st).toBeLessThan(calc.base_st_original);
  });

  it("aplica a carga do convênio ao ST informado manualmente", () => {
    const calc = calcularICMSProduto(
      item({
        cst: "10",
        decisao_manual: { modo: "ICMS_ST", mva_informada: 40, aplicar_reducao_5291: true },
      }),
      "SP",
      "BA",
    );
    expect(calc.tributacao).toBe("ICMS_ST");
    expect(calc.beneficio_5291?.carga_efetiva).toBe(5.14);
    expect(calc.base_st).toBeLessThan(100);
  });
});
