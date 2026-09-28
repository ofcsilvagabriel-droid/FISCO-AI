import { describe, it, expect } from "vitest";
import { calcularScoreNCMProporcional } from "../motorNCMProporcional";

describe("Motor NCM Proporcional", () => {
  it("4D legislados + 4D produto = 100% automático", () => {
    const r = calcularScoreNCMProporcional("22011234", "2201");
    expect(r.ncm_compativel).toBe(true);
    expect(r.score_ncm).toBe(100);
    expect(r.tipo_compatibilidade).toBe("PROPORCIONAL_4D");
    expect(r.motivo).toContain("4 dígitos");
  });

  it("5D legislados + 5D produto = 100% automático", () => {
    const r = calcularScoreNCMProporcional("22011234", "22011");
    expect(r.ncm_compativel).toBe(true);
    expect(r.score_ncm).toBe(100);
    expect(r.tipo_compatibilidade).toBe("PROPORCIONAL_5D");
  });

  it("6D legislados, conflito no 6º dígito = rejeição", () => {
    const r = calcularScoreNCMProporcional("22011334", "220112");
    expect(r.ncm_compativel).toBe(false);
    expect(r.score_ncm).toBe(0);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0].posicao).toBe(6);
  });

  it("produto com 3D e legislação de 5D = rejeição", () => {
    const r = calcularScoreNCMProporcional("220", "22011");
    expect(r.ncm_compativel).toBe(false);
    expect(r.score_ncm).toBe(0);
    expect(r.tipo_compatibilidade).toBe("INSUFICIENTE");
  });

  it("4D legislados + 8D produto = 100% (extras ignorados)", () => {
    const r = calcularScoreNCMProporcional("22019999", "2201");
    expect(r.ncm_compativel).toBe(true);
    expect(r.score_ncm).toBe(100);
    expect(r.avisos).toContain("Produto possui 8 dígitos, legislação apenas 4");
  });

  it("sem NCM na legislação = rejeição", () => {
    const r = calcularScoreNCMProporcional("22011234", "");
    expect(r.ncm_compativel).toBe(false);
    expect(r.score_ncm).toBe(0);
    expect(r.motivo).toContain("sem NCM");
  });

  it("7D legislados, todos iguais = 100% automático", () => {
    const r = calcularScoreNCMProporcional("22011234", "2201123");
    expect(r.ncm_compativel).toBe(true);
    expect(r.score_ncm).toBe(100);
    expect(r.tipo_compatibilidade).toBe("COMPLETO_7_8D");
  });

  it("7D legislados, conflito no 7º dígito = rejeição", () => {
    const r = calcularScoreNCMProporcional("22011234", "2201125");
    expect(r.ncm_compativel).toBe(false);
    expect(r.score_ncm).toBe(0);
    expect(r.conflitos[0].posicao).toBe(7);
  });

  it("conflito nos dígitos legislados rejeita imediatamente", () => {
    const r = calcularScoreNCMProporcional("22009999", "2201");
    expect(r.ncm_compativel).toBe(false);
    expect(r.conflitos[0].posicao).toBe(4);
  });

});
