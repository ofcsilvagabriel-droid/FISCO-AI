import { describe, expect, it } from "vitest";
import { aplicarOverrides, ratearPorValorProdutos, totaisAntecipacao } from "../simulacaoFiscal";

describe("simulação fiscal", () => {
  it("mantém o XML original ao aplicar override", () => {
    const original = { seq: "1", valor_total: 100, valor_frete: 10, ncm: "00000000" };
    const simulado = aplicarOverrides(original, { valor_total: 120, campo_invalido: 999 });
    expect(simulado).toMatchObject({ valor_total: 120, valor_frete: 10, ncm: "00000000" });
    expect(original.valor_total).toBe(100);
    expect(simulado.campo_invalido).toBeUndefined();
  });

  it("rateia cabeçalho proporcionalmente e conserva os centavos", () => {
    expect(ratearPorValorProdutos([{ valor_total: 10 }, { valor_total: 20 }, { valor_total: 70 }], 12.34))
      .toEqual([1.23, 2.47, 8.64]);
    expect(ratearPorValorProdutos([{ valor_total: 0 }, { valor_total: 0 }], 12.34)).toEqual([0, 0]);
  });

  it("reduz apenas itens de antecipação e arredonda cada item", () => {
    const resultado = totaisAntecipacao([
      { tributacao: "ANTECIPACAO", valor_icms_st: 10.01 },
      { tributacao: "ICMS_ST", valor_icms_st: 99 },
      { tributacao: "ANTECIPACAO", valor_icms_st: 5.02 },
    ]);
    expect(resultado).toEqual({ bruto: 15.03, comReducao: 12.03, reducaoPct: 20 });
  });

  it("retorna zero sem antecipação", () => {
    expect(totaisAntecipacao([{ tributacao: "DIFAL", valor_icms_st: 10 }]))
      .toEqual({ bruto: 0, comReducao: 0, reducaoPct: 0 });
  });
});
