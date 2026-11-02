import { describe, expect, it } from "vitest";
import { calcularDigitoVerificadorChaveNfe, chaveNfeValida } from "../chaveNfe";

function criarChaveValida() {
  const base = "2926111234567800019555001000000001100000001";
  return `${base}${calcularDigitoVerificadorChaveNfe(base)}`;
}

describe("chave de acesso da NF-e", () => {
  it("aceita NF-e modelo 55 com dígito verificador correto", () => {
    expect(chaveNfeValida(criarChaveValida())).toBe(true);
  });

  it("rejeita outro modelo e chave adulterada", () => {
    const chave = criarChaveValida();
    expect(chaveNfeValida(`${chave.slice(0, 20)}65${chave.slice(22)}`)).toBe(false);
    expect(chaveNfeValida(`${chave.slice(0, 43)}${chave[43] === "9" ? "8" : "9"}`)).toBe(false);
  });

  it("rejeita campos ausentes e formatos não numéricos", () => {
    expect(chaveNfeValida("")).toBe(false);
    expect(chaveNfeValida("A".repeat(44))).toBe(false);
  });
});
