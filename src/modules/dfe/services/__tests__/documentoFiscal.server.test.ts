import { describe, expect, it } from "vitest";
import { calcularDigitoVerificadorChaveNfe } from "@/modules/xml/domain/chaveNfe";
import {
  identificarDestinatarioXmlNfeCompleta,
  validarXmlNfeCompleta,
} from "../documentoFiscal.server";

function xmlEntrada(ufOrigem: string, ufDestino: string, cnpjDestino = "12345678000276") {
  const base = "2926119876543200010055001000000001100000001";
  const chave = `${base}${calcularDigitoVerificadorChaveNfe(base)}`;
  return Buffer.from(
    `<nfeProc><NFe><infNFe Id="NFe${chave}"><ide><mod>55</mod><nNF>1</nNF><serie>1</serie><dhEmi>2026-11-02T10:00:00-03:00</dhEmi></ide>` +
      `<emit><CNPJ>98765432000100</CNPJ><xNome>Fornecedor</xNome><enderEmit><UF>${ufOrigem}</UF></enderEmit></emit>` +
      `<dest><CNPJ>${cnpjDestino}</CNPJ><enderDest><UF>${ufDestino}</UF></enderDest></dest>` +
      `<det nItem="1"><prod><cProd>1</cProd></prod></det><total><ICMSTot><vNF>100.00</vNF></ICMSTot></total></infNFe></NFe>` +
      `<protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat><nProt>123</nProt></infProt></protNFe></nfeProc>`,
  );
}

describe("validação do XML de entrada", () => {
  it("aceita NF-e interestadual destinada a estabelecimento da mesma raiz", () => {
    expect(validarXmlNfeCompleta(xmlEntrada("SP", "BA"), "12345678000195")).toMatchObject({
      uf_origem: "SP",
      uf_destino: "BA",
      valor_total_xml: "100.00",
    });
  });

  it("aceita NF-e interna para arquivamento sem cálculo interestadual", () => {
    expect(validarXmlNfeCompleta(xmlEntrada("BA", "BA"), "12345678000195")).toMatchObject({
      uf_origem: "BA",
      uf_destino: "BA",
    });
  });

  it("rejeita documento sem protocolo ou destinado a outra raiz de CNPJ", () => {
    expect(() =>
      validarXmlNfeCompleta(xmlEntrada("SP", "BA", "87654321000100"), "12345678000195"),
    ).toThrow();
    const semProtocolo = Buffer.from(
      xmlEntrada("SP", "BA").toString().replace("<nProt>123</nProt>", ""),
    );
    expect(() => validarXmlNfeCompleta(semProtocolo, "12345678000195")).toThrow();
  });

  it("identifica o CNPJ destinatário sem depender da empresa ativa", () => {
    expect(identificarDestinatarioXmlNfeCompleta(xmlEntrada("SP", "BA"))).toMatchObject({
      destinatario_cnpj: "12345678000276",
    });
  });
});
