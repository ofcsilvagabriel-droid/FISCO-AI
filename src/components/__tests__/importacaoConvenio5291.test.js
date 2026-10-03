import { afterAll, describe, expect, it, vi } from "vitest";
import { DOMParser as XMLDOMParser } from "@xmldom/xmldom";
import { parsearNFe } from "@/modules/xml/services/parsearNFe";
import { calcularICMSProduto } from "../FiscoAI";

const elementProto = Object.getPrototypeOf(new XMLDOMParser().parseFromString("<x/>", "text/xml").documentElement);
Object.defineProperty(elementProto, "firstElementChild", {
  configurable: true,
  get() { return Array.from(this.childNodes || []).find((node) => node.nodeType === 1) || null; },
});
vi.stubGlobal("DOMParser", XMLDOMParser);
afterAll(() => vi.unstubAllGlobals());

const det = (seq, ncm, descricao, cst = "00", valor = 100, ipi = 0) => `
  <det nItem="${seq}"><prod><cProd>${seq}</cProd><xProd>${descricao}</xProd><NCM>${ncm}</NCM><CFOP>6102</CFOP><qCom>1</qCom><vUnCom>${valor}</vUnCom><vProd>${valor}</vProd></prod>
  <imposto><ICMS><ICMS${cst}><orig>0</orig><CST>${cst}</CST><vBC>${valor}</vBC><pICMS>7</pICMS><vICMS>7</vICMS></ICMS${cst}></ICMS>
  <IPI><IPITrib><vIPI>${ipi}</vIPI></IPITrib></IPI></imposto></det>`;

const xml = (origem, destino, itens) => `<NFe><infNFe Id="NFeTESTE"><ide><nNF>1</nNF><serie>1</serie><dhEmi>2026-10-03</dhEmi></ide>
  <emit><CNPJ>11111111000111</CNPJ><enderEmit><UF>${origem}</UF></enderEmit></emit>
  <dest><CNPJ>22222222000122</CNPJ><enderDest><UF>${destino}</UF></enderDest></dest>${itens}</infNFe></NFe>`;

describe("NF-e importada com Convênio 52/91", () => {
  it("reduz apenas o item industrial elegível, mesmo com IPI e outro NCM na nota", () => {
    const { nota, produtos, erro } = parsearNFe(xml("SP", "BA",
      det(1, "82073000", "Ferramenta industrial", "00", 100, 20) +
      det(2, "99999999", "Mercadoria comum", "00", 100)));
    expect(erro).toBeNull();
    expect(produtos).toHaveLength(2);
    const calculos = produtos.map((produto) => calcularICMSProduto({ ...produto, __simulacao: true }, nota.uf_origem, nota.uf_destino));
    expect(calculos[0].tributacao).toBe("ANTECIPACAO");
    expect(calculos[0].base_calc).toBe(120);
    expect(calculos[0].base_st).toBeCloseTo(120 * 8.8 / 20.5, 4);
    expect(calculos[1].beneficio_5291).toBeNull();
    expect(calculos[1].base_st).toBe(100);
  });

  it("aplica a carga agrícola a nota de outra origem, sem depender de quantidade fixa de itens", () => {
    const { nota, produtos } = parsearNFe(xml("GO", "BA",
      det(1, "87019200", "Trator agrícola", "00", 100, 10) +
      det(2, "87019200", "Trator agrícola", "00", 200, 20) +
      det(3, "99999999", "Mercadoria comum", "00", 50)));
    const calculos = produtos.map((produto) => calcularICMSProduto({ ...produto, __simulacao: true }, nota.uf_origem, nota.uf_destino));
    expect(calculos).toHaveLength(3);
    expect(calculos[0].beneficio_5291?.anexo).toBe("II");
    expect(calculos[0].base_st).toBeCloseTo(110 * 5.6 / 20.5, 4);
    expect(calculos[1].base_st).toBeCloseTo(220 * 5.6 / 20.5, 4);
    expect(calculos[2].base_st).toBe(50);
  });

  it("não concede redução quando o XML traz operação não tributada", () => {
    const { nota, produtos } = parsearNFe(xml("SP", "BA", det(1, "82073000", "Ferramenta industrial", "41")));
    const calc = calcularICMSProduto({ ...produtos[0], __simulacao: true }, nota.uf_origem, nota.uf_destino);
    expect(calc.tributacao).toBe("NAO_TRIBUTADO");
    expect(calc.valor_icms_st).toBe(0);
  });
});
