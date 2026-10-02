import { describe, expect, it } from "vitest";
import { beneficio5291, identificarConv5291 } from "../data/conv5291";
import { matchConvenioEstrito } from "../engines/motorConvenio";

describe("redução do Convênio 52/91 por NCM", () => {
  it("enquadra NCM industrial mesmo com descrição abreviada e calcula a carga da operação", () => {
    const regra = identificarConv5291("82073000")?.regra;
    expect(
      matchConvenioEstrito({ ncm: "82073000", descricao: "FERR. PUNC." }, regra),
    ).toMatchObject({
      enquadrado: true,
      ncmExato: true,
      descCompativel: false,
    });
    expect(beneficio5291("82073000", "SP", "BA", 20.5, "FERR. PUNC.")?.carga_efetiva).toBe(5.14);
  });

  it("reconhece o segundo NCM de um item agrícola com alternativas", () => {
    const encontrado = identificarConv5291("87019200", "Trator agrícola de rodas");
    expect(encontrado?.anexo).toBe("II");
    expect(
      matchConvenioEstrito({ ncm: "87019200", descricao: "Trator agrícola" }, encontrado.regra)
        .enquadrado,
    ).toBe(true);
    expect(beneficio5291("87019200", "GO", "BA", 20.5, "Trator agrícola")?.carga_efetiva).toBe(7);
    expect(beneficio5291("87019200", "BA", "BA", 20.5, "Trator agrícola")?.carga_efetiva).toBe(5.6);
  });

  it("não aplica benefício a NCM não listado e mantém isenção com filtro descritivo", () => {
    expect(beneficio5291("99999999", "SP", "BA", 20.5)).toBeNull();
    expect(
      matchConvenioEstrito(
        { ncm: "84335129", descricao: "Outra mercadoria" },
        {
          tipo: "ISENCAO",
          ncm: "84335129",
          descricao: "Colheitadeira",
          fundamento: "Convênio ICMS 101/97",
        },
      ).enquadrado,
    ).toBe(false);
  });
});
