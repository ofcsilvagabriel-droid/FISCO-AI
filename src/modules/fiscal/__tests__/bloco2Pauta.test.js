import { describe, it, expect } from "vitest";
import { resolverPauta } from "../engines/motorPauta";
import { calcularSTporPauta } from "../engines/motorST";

describe("Bloco 2 — pauta PMC/PMPF com fallback para MVA", () => {
  it("usa o PMC informado na NF-e", () => {
    const r = resolverPauta({ ncm: "22021000", vPMC: 10 });
    expect(r.metodo).toBe("PMC");
    expect(r.avisos).toHaveLength(0);
  });

  it("medicamento sem lista CMED cai em MVA com aviso visível", () => {
    const r = resolverPauta({ ncm: "30049099" });
    expect(r.metodo).toBe("MVA");
    expect(r.pautaEsperada).toBe(true);
    expect(r.avisos[0].tipo).toBe("PAUTA_INDISPONIVEL");
    expect(r.avisos[0].mensagem).toMatch(/CMED/i);
  });

  it("combustível sem Ato COTEPE cai em MVA com aviso visível", () => {
    const r = resolverPauta({ ncm: "27101259" });
    expect(r.metodo).toBe("MVA");
    expect(r.avisos[0].mensagem).toMatch(/COTEPE/i);
  });

  it("produto comum sem pauta segue por MVA sem alarme falso", () => {
    const r = resolverPauta({ ncm: "84713012" });
    expect(r.metodo).toBe("MVA");
    expect(r.pautaEsperada).toBe(false);
    expect(r.avisos).toHaveLength(0);
  });

  it("calcularSTporPauta propaga avisos e calcula por MVA", () => {
    const r = calcularSTporPauta({
      ncm: "30049099",
      mva: 50,
      valorProduto: 100,
      aliquotaInterna: 20.5,
      icmsProprio: 12,
    });
    expect(r.metodo).toBe("MVA");
    expect(r.base_calculo).toBeCloseTo(150, 2);
    expect(r.avisos.length).toBeGreaterThan(0);
  });

  it("calcularSTporPauta com PMC usa quantidade × preço", () => {
    const r = calcularSTporPauta({
      vPMC: 20,
      quantidade: 3,
      aliquotaInterna: 20,
      icmsProprio: 5,
    });
    expect(r.metodo).toBe("PMC");
    expect(r.base_calculo).toBe(60);
    expect(r.icms_st).toBeCloseTo(7, 2);
  });
});
