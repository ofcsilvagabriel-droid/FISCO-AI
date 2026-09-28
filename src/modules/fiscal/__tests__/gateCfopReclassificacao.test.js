// Gate CST/CSOSN × CFOP + recálculo automático na reclassificação manual.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    globalThis.localStorage = memStorage();
  }
});

let interpretarCFOP, avaliarLiberacaoCalculo, ExecucaoTributariaService;

beforeAll(async () => {
  ({ interpretarCFOP } = await import("../engines/motorCFOP"));
  ({ avaliarLiberacaoCalculo } = await import("../engines/gateTributario"));
  ({ ExecucaoTributariaService } = await import("../execucao/services/ExecucaoTributariaService"));
});

beforeEach(() => globalThis.localStorage.clear());

describe("motorCFOP", () => {
  it("bloqueia CFOP de comodato", () => {
    const p = interpretarCFOP("5908");
    expect(p.geraICMS).toBe(false);
    expect(p.calculosProibidos).toContain("ICMS_PROPRIO");
  });

  it("marca CFOP título como erro de lançamento", () => {
    const p = interpretarCFOP("5900");
    expect(p.titulo).toBe(true);
    expect(p.geraICMS).toBe(false);
  });

  it("deixa 5949 indefinido para revisão manual", () => {
    const p = interpretarCFOP("5949");
    expect(p.geraICMS).toBeNull();
    expect(p.revisaoManual).toBe(true);
  });

  it("identifica ST já recolhida no CFOP de substituído", () => {
    expect(interpretarCFOP("5405").stJaRecolhida).toBe(true);
  });
});

describe("gate tributário", () => {
  it("bloqueia ICMS e ST quando o CFOP não gera ICMS", () => {
    const g = avaliarLiberacaoCalculo({ cst: "00", cfop: "5911", ncm: "22021000" });
    expect(g.liberado.ICMS_PROPRIO).toBe(false);
    expect(g.liberado.ICMS_ST).toBe(false);
    expect(g.bloqueios[0]).toMatchObject({ status: "BLOQUEADO", valor_calculado: 0 });
    expect(g.bloqueios[0].fundamento).toBeTruthy();
  });

  it("sinaliza conflito entre CST tributado e CFOP sem incidência", () => {
    const g = avaliarLiberacaoCalculo({ cst: "00", cfop: "5915" });
    expect(g.conflito).toBe(true);
  });

  it("não bloqueia operação normal", () => {
    const g = avaliarLiberacaoCalculo({ cst: "00", cfop: "5102" });
    expect(g.liberado.ICMS_PROPRIO).toBe(true);
  });
});

describe("reclassificar → recálculo automático", () => {
  it("recalcula e bloqueia ICMS quando o usuário troca para CFOP sem incidência", () => {
    const exec = ExecucaoTributariaService.registrar({
      empresaId: "e1",
      produtoId: "p1",
      classificacao: { cst: "00", cfop: "5102", ncm: "84181000" },
      calculo: { valor_icms_proprio: 180 },
    });

    const nova = ExecucaoTributariaService.reclassificar(exec.id, {
      cst: "00", cfop: "5908", ncm: "84181000", valor_icms: 180,
    }, "u1");

    expect(nova.status).toBe("RECALCULADA");
    expect(nova.calculo.status).toBe("BLOQUEADO");
    expect(nova.calculo.valor_icms_proprio).toBe(0);
    expect(nova.calculo.valor_icms_st).toBe(0);
    expect(nova.calculo.motivo).toMatch(/CFOP/i);
    expect(nova.fundamentos.length).toBeGreaterThan(0);
    expect(nova.memoria.length).toBeGreaterThan(0);
  });

  it("mantém cálculo liberado quando a nova classificação é tributada", () => {
    const exec = ExecucaoTributariaService.registrar({
      empresaId: "e1", produtoId: "p2",
      classificacao: { cst: "00", cfop: "5102" },
    });
    const nova = ExecucaoTributariaService.reclassificar(exec.id, {
      cst: "00", cfop: "5102", valor_icms: 100, base_icms: 1000,
    });
    expect(nova.calculo.status).toBe("CALCULADO");
    expect(nova.calculo.valor_icms_proprio).toBe(100);
  });
});
