import { describe, it, expect } from "vitest";
import { resolverIcmsProprio } from "../domain/engines/IcmsProprioEngine";

describe("ICMS próprio — alíquota do XML vs presumida", () => {
  it("TESTE 1 — XML completo usa a alíquota e o valor do XML", () => {
    const r = resolverIcmsProprio({
      baseIcmsXml: 10000, aliquotaXml: 18, valorIcmsXml: 1800,
    });
    expect(r.icms_proprio_calculado).toBe(1800);
    expect(r.origem_aliquota_icms).toBe("XML");
  });

  it("TESTE 2 — XML sem alíquota usa a presumida", () => {
    const r = resolverIcmsProprio({
      baseIcmsXml: 10000, aliquotaPresumida: 18,
    });
    expect(r.icms_proprio_calculado).toBe(1800);
    expect(r.origem_aliquota_icms).toBe("PRESUMIDA");
    expect(r.presumido).toBe(true);
  });

  it("TESTE 3 — vICMS zerado no XML não impede o cálculo", () => {
    const r = resolverIcmsProprio({
      baseIcmsXml: 10000, aliquotaXml: 0, valorIcmsXml: 0, aliquotaPresumida: 18,
    });
    expect(r.icms_proprio_calculado).toBe(1800);
  });

  it("TESTE 3.B — alíquota no XML com vICMS zerado calcula pela alíquota do XML", () => {
    const r = resolverIcmsProprio({
      baseIcmsXml: 10000, aliquotaXml: 12, valorIcmsXml: 0,
    });
    expect(r.icms_proprio_calculado).toBe(1200);
    expect(r.origem_aliquota_icms).toBe("XML");
  });

  it("TESTE 4 — isenção não gera ICMS", () => {
    const r = resolverIcmsProprio({
      baseIcmsXml: 10000, aliquotaPresumida: 18, situacao: "ISENTA",
    });
    expect(r.icms_proprio_calculado).toBe(0);
  });

  it("TESTE 5 — não incidência não gera ICMS", () => {
    const r = resolverIcmsProprio({
      baseIcmsXml: 10000, aliquotaPresumida: 18, situacao: "NAO_INCIDENCIA",
    });
    expect(r.icms_proprio_calculado).toBe(0);
  });

  it("TESTE 6 — sem base de cálculo não gera ICMS", () => {
    const r = resolverIcmsProprio({
      baseIcmsXml: 0, valorTotal: 0, aliquotaPresumida: 18,
    });
    expect(r.icms_proprio_calculado).toBe(0);
    expect(r.base_calculo_icms).toBe(0);
  });

  it("sem alíquota nenhuma → NAO_DETERMINADA", () => {
    const r = resolverIcmsProprio({ baseIcmsXml: 1000 });
    expect(r.origem_aliquota_icms).toBe("NAO_DETERMINADA");
  });
});
