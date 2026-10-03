import { afterEach, describe, expect, it, vi } from "vitest";
import { calcularICMSProduto } from "../FiscoAI";
import { HistoricoApuracaoService } from "@/modules/fiscal/domain/services/HistoricoApuracaoService";
import { CongelamentoService } from "@/modules/fiscal/domain/services/CongelamentoService";

const dados = new Map();
vi.stubGlobal("localStorage", {
  getItem: (chave) => dados.get(chave) ?? null,
  setItem: (chave, valor) => dados.set(chave, String(valor)),
  removeItem: (chave) => dados.delete(chave),
});

const item = (campos = {}) => ({
  seq: "1", empresa_id: "EMPRESA_TESTE", ncm: "82073000",
  descricao: "Ferramenta industrial", cst: "10", cfop: "6102",
  valor_total: 200, base_icms: 200, aliquota_icms: 7, valor_icms: 14,
  analise: [], ...campos,
});

afterEach(() => dados.clear());

describe("Convênio 52/91 na memória protegida e no congelamento", () => {
  it("reaplica a redução manual de ST em outra nota sem reutilizar valores", () => {
    const anterior = calcularICMSProduto(item({ __simulacao: true, valor_total: 100, valor_icms: 7,
      decisao_manual: { modo: "ICMS_ST", mva_informada: 40, aplicar_reducao_5291: true } }), "SP", "BA");
    HistoricoApuracaoService.registrarAutomaticamenteNaMemoria({
      ncm: "82073000", calculo: anterior, tipoCalculo: "MANUAL_CONGELADO",
      empresaId: "EMPRESA_TESTE", aliquotaInterestadual: 7,
    });
    const novo = calcularICMSProduto(item({ valor_ipi: 20 }), "SP", "BA");
    expect(novo.memoria_apuracao?.origem_memoria).toBe("CONGELADO_MANUAL_INALTERADO");
    expect(novo.decisao_manual?.aplicar_reducao_5291).toBe(true);
    expect(novo.beneficio_5291?.anexo).toBe("I");
    expect(novo.base_st).toBeLessThan(novo.base_st_original);
    expect(novo.base_st_original).toBeGreaterThan(anterior.base_st_original);
  });

  it("aplica o convênio a registro antigo de ST sem a opção salva", () => {
    const decisaoAntiga = HistoricoApuracaoService.comoDecisaoManual({
      modo_decisao: "ICMS_ST", tributacao: "ICMS_ST", parametros: { mva_informada: 40 },
    });
    const calc = calcularICMSProduto(item({ __simulacao: true, decisao_manual: decisaoAntiga }), "SP", "BA");
    expect(calc.beneficio_5291?.anexo).toBe("I");
    expect(calc.base_st).toBeLessThan(calc.base_st_original);
  });

  it("mantém a exclusão explícita da redução em decisão manual", () => {
    const calc = calcularICMSProduto(item({ __simulacao: true, decisao_manual: {
      modo: "ICMS_ST", mva_informada: 40, aplicar_reducao_5291: false,
    } }), "SP", "BA");
    expect(calc.beneficio_5291).toBeNull();
    expect(calc.base_st).toBeCloseTo(calc.base_st_original, 4);
  });

  it("exibe o mesmo cálculo congelado, sem misturar uma base nova com valor antigo", () => {
    const antigo = calcularICMSProduto(item({ __simulacao: true, valor_total: 100, valor_icms: 7,
      decisao_manual: { modo: "ICMS_ST", mva_informada: 40, aplicar_reducao_5291: true } }), "SP", "BA");
    const congelado = CongelamentoService.congelarCalculo(item(), antigo);
    const automaticoNovo = calcularICMSProduto(item({ __simulacao: true, valor_total: 300 }), "SP", "BA");
    const exibido = CongelamentoService.obterCalculoExibivel(congelado, automaticoNovo);
    expect(exibido.base_st).toBe(antigo.base_st);
    expect(exibido.beneficio_5291).toEqual(antigo.beneficio_5291);
    expect(exibido.valor_icms_st).toBe(antigo.valor_icms_st);
    expect(exibido.base_st).not.toBe(automaticoNovo.base_st);
  });

  it("abre congelamento legado sem atribuir base recalculada ao imposto antigo", () => {
    const legado = { ...item(), calculo_congelado: {
      ativo: true, tributacao: "ICMS_ST", modo_decisao: "ICMS_ST",
      valor_icms: 7, valor_icms_st: 5, valor_icms_antecipacao: 0,
      valor_difal: 0, valor_fcp: 0, parametros_utilizados: { base_calc: 100, aliquota_icms: 7 },
    } };
    const automatico = calcularICMSProduto(item({ __simulacao: true }), "SP", "BA");
    const exibido = CongelamentoService.obterCalculoExibivel(legado, automatico);
    expect(exibido.valor_icms_st).toBe(5);
    expect(exibido.base_st).toBeNull();
    expect(exibido.detalhe_calculo_indisponivel).toBe(true);
  });
});
