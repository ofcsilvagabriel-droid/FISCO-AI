import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { criptografarCertificado, criptografarXml, descriptografarCertificado, descriptografarXml, inspecionarCertificado } from "../certificadoDfe.server";
import { extrairEntradaInterestadual, interpretarRetornoDfe, montarConsultaDfe } from "../distribuicaoDfe.server";

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

  it("mantém apenas NF-e completa de entrada interestadual destinada à empresa do certificado", () => {
    const xml = (ufEmitente: string, ufDestinatario: string, cnpjDestinatario = "12345678000276") => Buffer.from(
      `<nfeProc><NFe><infNFe><ide><mod>55</mod><nNF>7</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide>` +
      `<emit><CNPJ>98765432000100</CNPJ><xNome>Fornecedor de teste</xNome><enderEmit><UF>${ufEmitente}</UF></enderEmit></emit>` +
      `<dest><CNPJ>${cnpjDestinatario}</CNPJ><enderDest><UF>${ufDestinatario}</UF></enderDest></dest>` +
      `<total><ICMSTot><vNF>123.45</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`,
    );
    const cnpjCertificado = "12345678000195";
    expect(extrairEntradaInterestadual(xml("SP", "BA"), "procNFe_v4.00.xsd", cnpjCertificado)).toMatchObject({
      numero_nfe: "7", emitente_nome: "Fornecedor de teste", uf_origem: "SP", uf_destino: "BA", valor_total_xml: "123.45",
    });
    expect(extrairEntradaInterestadual(xml("BA", "BA"), "procNFe_v4.00.xsd", cnpjCertificado)).toBeNull();
    expect(extrairEntradaInterestadual(xml("SP", "BA"), "resNFe_v1.01.xsd", cnpjCertificado)).toBeNull();
    expect(extrairEntradaInterestadual(xml("SP", "BA", "87654321000100"), "procNFe_v4.00.xsd", cnpjCertificado)).toBeNull();
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
