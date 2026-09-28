import { describe, it, expect } from "vitest";
import { MotorTributarioService } from "../tributario";
import { EvidenceEngine } from "../tributario/engines/EvidenceEngine";
import { NcmMatcher } from "../tributario/matchers/NcmMatcher";
import { DescricaoMatcher } from "../tributario/matchers/DescricaoMatcher";
import { ClassificacaoPolicy } from "../tributario/policies/ClassificacaoPolicy";

describe("Motor de Evidências", () => {
  it("normaliza descrição, extrai palavras-chave e segmenta", () => {
    const p = EvidenceEngine.perfilar({ ncm: "04.06.10.10", descricao: "REQUEIJAO CREMOSO TIROLEZ 200G" });
    expect(p.ncm).toBe("04061010");
    expect(p.ncmNivel).toBe("ITEM");
    expect(p.palavrasChave).toContain("requeijao");
    expect(p.segmento).toBe("LATICINIOS");
    expect(p.evidencias.some((e) => e.tipo === "SEGMENTO")).toBe(true);
  });

  it("CEST entra como evidência com peso zero (validador)", () => {
    const p = EvidenceEngine.perfilar({ ncm: "22011000", descricao: "AGUA MINERAL", cest: "03.003.00" });
    const cest = p.evidencias.find((e) => e.tipo === "CEST");
    expect(cest?.peso).toBe(0);
  });
});

describe("NcmMatcher — hierarquia", () => {
  it("pontua por nível fechado", () => {
    expect(NcmMatcher.comparar("87089990", "87089990").pontos).toBe(50);
    expect(NcmMatcher.comparar("87089990", "870899").pontos).toBe(30);
    expect(NcmMatcher.comparar("87089990", "8708").pontos).toBe(15);
  });
  it("detecta conflito de dígito", () => {
    const r = NcmMatcher.comparar("87089990", "87081000");
    expect(r.compativel).toBe(false);
    expect(r.conflito?.posicao).toBe(5);
  });
});

describe("DescricaoMatcher", () => {
  it("mede similaridade semântica e não igualdade textual", () => {
    const s = DescricaoMatcher.similaridade("PASTILHA DE FREIO DIANTEIRA", "Pastilhas de freios");
    expect(s).toBeGreaterThan(0.3);
    expect(DescricaoMatcher.similaridade("CADERNO ESPIRAL", "Pastilhas de freios")).toBeLessThan(0.15);
  });
});

describe("Faixas de classificação", () => {
  it("respeita os intervalos definidos", () => {
    expect(ClassificacaoPolicy.faixa(97)).toBe("AUTOMATICA");
    expect(ClassificacaoPolicy.faixa(88)).toBe("ALTA_CONFIANCA");
    expect(ClassificacaoPolicy.faixa(75)).toBe("COM_ALERTA");
    expect(ClassificacaoPolicy.faixa(55)).toBe("REVISAO_OBRIGATORIA");
    expect(ClassificacaoPolicy.faixa(30)).toBe("NAO_CLASSIFICAR");
  });
});

describe("Contexto Tributário", () => {
  it("produz objeto completo com trilha de auditoria", () => {
    const ctx = MotorTributarioService.classificar({
      ncm: "22011000",
      descricao: "AGUA MINERAL NATURAL SEM GAS 500ML GARRAFA PET",
      ufOrigem: "SP",
      ufDestino: "BA",
    });
    expect(ctx.ncm).toBe("22011000");
    expect(ctx.score).toBeGreaterThanOrEqual(0);
    expect(ctx.confianca).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(ctx.trilha)).toBe(true);
    expect(ctx.regimes.some((r) => r.regime === "DIFAL")).toBe(true);
    expect(ctx.aliquotas.interna).toBeTruthy();
  });

  it("não classifica automaticamente quando não há aderência", () => {
    const ctx = MotorTributarioService.classificar({
      ncm: "99999999",
      descricao: "PRODUTO INEXISTENTE XYZ",
    });
    expect(ctx.classificavelAutomaticamente).toBe(false);
    expect(ctx.possuiST).toBe(false);
    expect(ctx.situacaoTributaria).toBe("SEM_ENQUADRAMENTO");
  });

  it("exceção impeditiva bloqueia mesmo com NCM aderente", () => {
    const ctx = MotorTributarioService.classificar({
      ncm: "22011000",
      descricao: "PARAFUSO SEXTAVADO INOX",   // descrição sem relação
    });
    expect(ctx.possuiST).toBe(false);
  });
});
