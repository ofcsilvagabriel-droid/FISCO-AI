import { describe, expect, it } from "vitest";
import { calcularDigitoVerificadorChaveNfe } from "../chaveNfe";
import { interpretarPlanilhaSefazCsv } from "../planilhaSefaz";

const baseChave = "2926111234567800019555001000000001100000001";
const chaveValida = `${baseChave}${calcularDigitoVerificadorChaveNfe(baseChave)}`;

describe("interpretarPlanilhaSefazCsv", () => {
  it("lê o relatório Consulta Destinatário da SEFAZ", () => {
    const csv = [
      "Numero NF-e;CNPJ/CPF Emitente;Razao Social Emitente;Data de Emissao;Data de Autorizacao;Valor;Chave de Acesso;UF Emit.;Situacao;Tipo Operacao;",
      ` 000.000.001; 12.345.678/0001-95; Emitente Teste; 01/11/2026 10:00:00 ; 01/11/2026 10:01:00 ;1.234,56;'${chaveValida}; BA; Autorizada; Saida;`,
    ].join("\r\n");

    const resultado = interpretarPlanilhaSefazCsv(csv);

    expect(resultado.chaves).toEqual([chaveValida]);
    expect(resultado.linhas[0]).toMatchObject({
      linha: 2,
      ufEmitente: "BA",
      situacao: "Autorizada",
    });
    expect(resultado.invalidas).toHaveLength(0);
  });

  it("elimina duplicadas e informa a linha de chaves inválidas", () => {
    const csv = [
      "Chave de Acesso;Situacao;",
      `'${chaveValida};Autorizada;`,
      `'${chaveValida};Autorizada;`,
      "'123;Autorizada;",
    ].join("\n");

    const resultado = interpretarPlanilhaSefazCsv(csv);

    expect(resultado.chaves).toEqual([chaveValida]);
    expect(resultado.duplicadas[0].linha).toBe(3);
    expect(resultado.invalidas[0].linha).toBe(4);
  });

  it("recusa CSV que não seja o modelo da SEFAZ", () => {
    expect(() => interpretarPlanilhaSefazCsv("Numero;Documento\n1;ABC")).toThrow(/Chave de Acesso/);
  });
});
