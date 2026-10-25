import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { criptografarCertificado, criptografarXml, descriptografarCertificado, descriptografarXml, inspecionarCertificado } from "../certificadoDfe.server";
import { interpretarRetornoDfe, montarConsultaDfe } from "../distribuicaoDfe.server";

describe("Distribuição DF-e", () => {
  it("monta consulta NSU sem dados de nota fixos", () => {
    const xml = montarConsultaDfe("12345678000195", "000000000000123");
    expect(xml).toContain("<CNPJ>12345678000195</CNPJ>");
    expect(xml).toContain("<ultNSU>000000000000123</ultNSU>");
    expect(() => montarConsultaDfe("<cnpj>", "0")).toThrow();
  });

  it("interpreta status e documentos compactados", () => {
    const resposta = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><ultNSU>000000000000002</ultNSU><maxNSU>000000000000003</maxNSU><loteDistDFeInt><docZip NSU="000000000000002" schema="resNFe_v1.01.xsd">H4sI</docZip></loteDistDFeInt></retDistDFeInt></soap:Body></soap:Envelope>`;
    expect(interpretarRetornoDfe(resposta)).toMatchObject({ cStat: "138", ultNsu: "000000000000002", documentos: [{ nsu: "000000000000002", schema: "resNFe_v1.01.xsd" }] });
    expect(() => interpretarRetornoDfe("<erro/>")).toThrow();
  });
});

describe("Proteção do certificado", () => {
  const anterior = process.env.FISCOAI_CERTIFICATE_ENCRYPTION_KEY;
  afterEach(() => { process.env.FISCOAI_CERTIFICATE_ENCRYPTION_KEY = anterior; });

  it("criptografa e rejeita adulteração", () => {
    process.env.FISCOAI_CERTIFICATE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const segredo = { pfx: "conteudo de teste", senha: "segredo de teste" };
    const cifra = criptografarCertificado(segredo);
    expect(cifra).not.toContain(segredo.senha);
    expect(descriptografarCertificado(cifra)).toEqual(segredo);
    expect(() => descriptografarCertificado(cifra.slice(0, -2) + "AA")).toThrow();
    const xml = Buffer.from("<nfeProc>teste</nfeProc>");
    const protegido = criptografarXml(xml);
    expect(protegido.includes(xml)).toBe(false);
    expect(descriptografarXml(protegido)).toEqual(xml);
    protegido[20] ^= 1;
    expect(() => descriptografarXml(protegido)).toThrow();
  });

  it("falha fechada sem chave e sem PFX válido", () => {
    delete process.env.FISCOAI_CERTIFICATE_ENCRYPTION_KEY;
    expect(() => criptografarCertificado({ pfx: "x", senha: "y" })).toThrow();
    expect(() => inspecionarCertificado(Buffer.from("inválido").toString("base64"), "senha")).toThrow();
  });
});
