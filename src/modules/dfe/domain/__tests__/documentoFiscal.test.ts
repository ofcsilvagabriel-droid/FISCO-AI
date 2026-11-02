import { describe, expect, it } from "vitest";
import {
  artefatoDocumentoFiscalSchema,
  competenciaDaEmissao,
  tipoConteudoPeloSchema,
} from "../documentoFiscal";

describe("contratos do hub Documentos Fiscais", () => {
  it("organiza a NF-e pela competência da emissão", () => {
    expect(competenciaDaEmissao("2026-10-30T12:00:00-03:00")).toBe("2026-10");
    expect(competenciaDaEmissao(undefined)).toBeNull();
    expect(competenciaDaEmissao("data-inválida")).toBeNull();
  });

  it("aceita somente XML completo de NF-e", () => {
    expect(tipoConteudoPeloSchema("procNFe_v4.00.xsd")).toBe("XML_COMPLETO");
    expect(() => tipoConteudoPeloSchema("resNFe_v1.01.xsd")).toThrow();
    expect(() => tipoConteudoPeloSchema("procEventoNFe_v1.00.xsd")).toThrow();
  });

  it("exige identidade e integridade do arquivo armazenado", () => {
    const artefato = {
      documentoId: "d640b471-425f-48bd-bacc-28288880a6b0",
      empresaCnpj: "12345678000190",
      tipo: "XML_ORIGINAL",
      sha256: "a".repeat(64),
      storagePath: "usuario/empresa/2026/10/documento.enc",
      contentType: "application/octet-stream",
      tamanhoBytes: 1024,
    };
    expect(artefatoDocumentoFiscalSchema.parse(artefato)).toEqual(artefato);
    expect(() =>
      artefatoDocumentoFiscalSchema.parse({ ...artefato, sha256: "inválido" }),
    ).toThrow();
  });
});
