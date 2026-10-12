import { afterEach, describe, expect, it, vi } from "vitest";
import { DOMParser as XMLDOMParser } from "@xmldom/xmldom";
import { parsearNFe } from "@/modules/xml/services/parsearNFe";
import { calcularICMSProduto } from "../FiscoAI";
import { HistoricoApuracaoService } from "@/modules/fiscal/domain/services/HistoricoApuracaoService";
import { CongelamentoService } from "@/modules/fiscal/domain/services/CongelamentoService";
import { aplicarOverrides, totaisAntecipacao } from "@/modules/fiscal/domain/engines/simulacaoFiscal";

const proto = Object.getPrototypeOf(new XMLDOMParser().parseFromString("<x/>", "text/xml").documentElement);
Object.defineProperty(proto, "firstElementChild", {
  configurable: true,
  get() { return Array.from(this.childNodes || []).find(node => node.nodeType === 1) || null; },
});
const dados = new Map();
vi.stubGlobal("DOMParser", XMLDOMParser);
vi.stubGlobal("localStorage", {
  getItem: chave => dados.get(chave) ?? null,
  setItem: (chave, valor) => dados.set(chave, String(valor)),
});
afterEach(() => dados.clear());

const item = (campos = {}) => ({
  seq: "1", empresa_id: "EMPRESA_TESTE", ncm: "99999999", descricao: "Produto de teste",
  cst: "00", cfop: "6102", orig: "0", base_icms: 850, valor_total: 1000,
  aliquota_icms: 4, valor_icms: 34, valor_frete: 30, valor_seguro: 10,
  valor_outras_desp: 5, valor_desconto: 20, valor_ipi: 40, analise: [], ...campos,
});

describe("consistência de alíquota e ICMS próprio por item", () => {
  it.each(["AUTO", "ANTECIPACAO", "ICMS_ST", "DIFAL"])("preserva XML de 4 por cento ao calcular e congelar %s", modo => {
    const produto = item({ decisao_manual: { modo, mva_informada: 40 } });
    const calc = calcularICMSProduto(produto, "SP", "BA");
    expect(calc.aliquota_aplicada).toBe(4);
    expect(calc.aliquota_icms_utilizada).toBe(4);
    expect(calc.valor_icms_proprio).toBe(34);
    expect(calc.icms_nf_original).toBe(34);
    expect(calc.base_calculo_icms).toBe(850);
    const congelado = CongelamentoService.congelarCalculo(produto, calc);
    expect(CongelamentoService.obterCalculoExibivel(congelado, calc).aliquota_aplicada).toBe(4);
  });

  it("usa a mesma alíquota no DIFAL e na fórmula exibida", () => {
    const calc = calcularICMSProduto(item({ decisao_manual: { modo: "DIFAL" } }), "SP", "BA");
    expect(calc.base_st).toBeCloseTo(1065 * (1 - 0.04) / (1 - 0.205), 6);
    expect(calc.valor_difal).toBeCloseTo(calc.base_st * 0.205 - 34, 6);
  });

  it("não mistura memórias de MVA de 4%, 7% e 12%", () => {
    for (const [aliquota, mva] of [[4, 40], [7, 55], [12, 70]]) {
      const produto = item({ aliquota_icms: aliquota, valor_icms: aliquota * 8.5,
        decisao_manual: { modo: "ICMS_ST", mva_informada: mva, mva_ja_ajustada: true } });
      const calc = calcularICMSProduto(produto, "SP", "BA");
      CongelamentoService.congelarCalculoComMemoria(produto, calc, "Teste", "Teste", "EMPRESA_TESTE");
    }
    for (const [aliquota, mva] of [[4, 40], [7, 55], [12, 70]]) {
      const calc = calcularICMSProduto(item({ aliquota_icms: aliquota, valor_icms: aliquota * 8.5 }), "SP", "BA");
      expect(calc.mva_utilizada).toBe(mva);
      expect(calc.aliquota_aplicada).toBe(aliquota);
      expect(calc.valor_icms_proprio).toBe(aliquota * 8.5);
    }
  });

  it("preserva destaque com arredondamento quando a base já está reduzida", () => {
    const calc = calcularICMSProduto(item({ ncm: "82073000", cst: "20", valor_icms: 33.99 }), "SP", "MG");
    expect(calc.valor_icms_proprio).toBe(33.99);
    expect(calc.icms_nf_original).toBe(33.99);
  });

  it("não apresenta ICMS presumido como valor original do XML nem altera o produto", () => {
    const produto = item({ aliquota_icms: 0, valor_icms: 0 });
    const original = structuredClone(produto);
    const calc = calcularICMSProduto(produto, "GO", "BA");
    expect(calc.icms_proprio_presumido).toBe(true);
    expect(calc.valor_icms_proprio).toBeGreaterThan(0);
    expect(calc.icms_nf_original).toBe(0);
    expect(calc.icms_destacado_nf).toBe(false);
    expect(produto).toEqual(original);
  });

  it("mantém cada destaque de uma nota mista e zeros explicitamente informados", () => {
    const itens = [[4, 34], [7, 59.5], [12, 102], [0, 0]].map(([aliq, valor], index) => `
      <det nItem="${index + 1}"><prod><NCM>99999999</NCM><CFOP>6102</CFOP><vProd>1000</vProd></prod>
      <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>850</vBC><pICMS>${aliq}</pICMS><vICMS>${valor}</vICMS></ICMS00></ICMS></imposto></det>`).join("");
    const parsed = parsearNFe(`<NFe><infNFe><ide/><emit><enderEmit><UF>SP</UF></enderEmit></emit><dest><enderDest><UF>BA</UF></enderDest></dest>${itens}</infNFe></NFe>`);
    expect(parsed.erro).toBeNull();
    const calculos = parsed.produtos.map(p => calcularICMSProduto(p, parsed.nota.uf_origem, parsed.nota.uf_destino));
    expect(calculos.map(c => c.aliquota_aplicada)).toEqual([4, 7, 12, 0]);
    expect(calculos.map(c => c.valor_icms_proprio)).toEqual([34, 59.5, 102, 0]);
  });

  it("simula mudança explícita de alíquota sem modificar o destaque original", () => {
    const produto = item();
    const simulado = aplicarOverrides(produto, { aliquota_icms: 7 });
    const calc = calcularICMSProduto(simulado, "SP", "BA");
    expect(calc.aliquota_aplicada).toBe(7);
    expect(calc.valor_icms_proprio).toBe(59.5);
    expect(calc.icms_nf_original).toBe(34);
    expect(produto.aliquota_icms).toBe(4);
    expect(produto.valor_icms).toBe(34);
  });

  it.each(["40", "41", "60", "500"])("não cria imposto próprio indevido para CST/CSOSN %s", cst => {
    const calc = calcularICMSProduto(item({ cst, valor_icms: 0, aliquota_icms: 0 }), "SP", "BA");
    expect(calc.valor_icms_proprio).toBe(0);
    expect(calc.icms_nf_original).toBe(0);
  });

  it("preserva a regressão financeira aprovada da NF 580476 sem regra específica", () => {
    // Dados sanitizados do XML indicado pelo usuário; nunca usados pelo motor.
    const calculos = [[8445, 1013.4], [7038, 844.56]].map(([total, icms], indice) =>
      calcularICMSProduto(item({ seq: String(indice + 1), ncm: "20029000", cfop: "6101",
        valor_total: total, base_icms: total, aliquota_icms: 12, valor_icms: icms,
        valor_frete: 0, valor_seguro: 0, valor_outras_desp: 0, valor_desconto: 0, valor_ipi: 0,
      }), "GO", "BA"));
    expect(calculos.map(c => c.valor_icms_proprio)).toEqual([1013.4, 844.56]);
    expect(calculos.map(c => Number(c.valor_icms_st.toFixed(2)))).toEqual([717.82, 598.23]);
    expect(totaisAntecipacao(calculos).bruto).toBe(1316.05);
  });

  it("conserva destaque e alíquota no histórico serializado sem campos novos", () => {
    const produto = item({ decisao_manual: { modo: "ICMS_ST", mva_informada: 40 } });
    const calc = calcularICMSProduto(produto, "SP", "BA");
    const salvo = JSON.parse(JSON.stringify(CongelamentoService.congelarCalculo(produto, calc)));
    const reaberto = CongelamentoService.obterCalculoExibivel(salvo, calcularICMSProduto(salvo, "SP", "BA"));
    expect(reaberto.aliquota_aplicada).toBe(4);
    expect(reaberto.valor_icms_proprio).toBe(34);
    expect(reaberto.valor_icms_total).toBe(calc.valor_icms_total);
  });

  it("mantém zero em reclassificação explícita como isento e preserva XML para conferência", () => {
    const calc = calcularICMSProduto(item({ decisao_manual: { modo: "ISENTO" } }), "SP", "BA");
    expect(calc.valor_icms_proprio).toBe(0);
    expect(calc.valor_icms_total).toBe(0);
    expect(calc.aliquota_aplicada).toBe(0);
    expect(calc.icms_nf_original).toBe(34);
  });

  it("alinha cálculo e memória quando pICMS está ausente mas há base e destaque", () => {
    const calc = calcularICMSProduto(item({ aliquota_icms: undefined }), "SP", "BA");
    expect(calc.aliquota_aplicada).toBe(4);
    expect(calc.aliquota_interestadual).toBe(4);
    expect(calc.valor_icms_proprio).toBe(34);
  });
});
