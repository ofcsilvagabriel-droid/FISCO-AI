import { describe, expect, it } from "vitest";
import { atualizarCalculadora, estadoInicial } from "../calculadora";

const calcular = teclas => teclas.reduce(atualizarCalculadora, { ...estadoInicial });

describe("calculadora flutuante", () => {
  it("calcula decimais sem exibir ruído de ponto flutuante", () => {
    expect(calcular(["0", ",", "1", "+", "0", ",", "2", "="]).visor).toBe("0,3");
  });
  it("aplica acréscimo, desconto e multiplicação por percentual", () => {
    expect(calcular(["1", "0", "0", "+", "1", "0", "%", "="]).visor).toBe("110");
    expect(calcular(["1", "0", "0", "−", "2", "0", "%", "="]).visor).toBe("80");
    expect(calcular(["1", "0", "0", "×", "4", "%", "="]).visor).toBe("4");
  });
  it("avisa sobre divisão por zero e aceita novo cálculo", () => {
    const erro = calcular(["5", "÷", "0", "="]);
    expect(erro.erro).toBe(true);
    expect(atualizarCalculadora(erro, "2").visor).toBe("2");
  });
  it("permite trocar operador, inverter sinal e apagar", () => {
    expect(calcular(["9", "+", "×", "2", "="]).visor).toBe("18");
    expect(calcular(["8", "±", "⌫"]).visor).toBe("0");
    expect(calcular(["1", "2", "⌫"]).visor).toBe("1");
  });
});
