import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizarNCM,
  calcularScoreNCM,
  calcularScoreDescricao,
  classificarProduto,
  _resetRegistroParaTeste,
} from "../engines/motorClassificacaoST";

// Regras sintéticas usadas para isolar o pipeline dos dados oficiais.
const REGRAS_TESTE = [
  {
    id: "R_2201", item_ricms: "3.3", cest: "03.003.00",
    ncm_patterns: ["2201"], // POSICAO (4 dígitos)
    descricao_legal: "Água mineral, gasosa ou não, potável, natural",
    segmento: "BEBIDAS",
    palavras_obrigatorias: ["agua"], sinonimos: ["aguas"], palavras_excludentes: ["destilada"],
    ufs_signatarias: { modo: "TODOS_EXCETO", ufs: ["MG","RS"] }, acordo: "Prot. ICMS 11/91",
    mva_original: 120, mva_ajustada_4: 158, mva_ajustada_7: 150, mva_ajustada_12: 136,
    fundamento: "RICMS/BA Anexo 1 – Bebidas",
  },
  {
    id: "R_39211200", item_ricms: "10.1", cest: null,
    ncm_patterns: ["39211200"], // ITEM (8 dígitos)
    descricao_legal: "Chapa de plástico esponjoso para construção civil",
    segmento: "CONSTRUCAO",
    palavras_obrigatorias: ["chapa","construcao"], sinonimos: ["placa"], palavras_excludentes: [],
    ufs_signatarias: { modo: "TODOS", ufs: [] }, acordo: "Prot. 32/14",
    mva_original: null, mva_ajustada_4: 60, mva_ajustada_7: 55, mva_ajustada_12: 45,
    fundamento: "RICMS/BA Anexo 1 – Construção",
  },
  {
    id: "R_220210", item_ricms: "3.10", cest: "03.010.00",
    ncm_patterns: ["220210"],
    descricao_legal: "Refrigerante em embalagem plástica",
    segmento: "BEBIDAS",
    palavras_obrigatorias: ["refrigerante"], sinonimos: ["refri"], palavras_excludentes: [],
    ufs_signatarias: { modo: "TODOS", ufs: [] }, acordo: "",
    mva_original: 70, mva_ajustada_4: 90, mva_ajustada_7: 82, mva_ajustada_12: 75,
    fundamento: "RICMS/BA Anexo 1",
  },
];

beforeEach(() => _resetRegistroParaTeste(REGRAS_TESTE));

describe("normalizarNCM", () => {
  it("remove pontuação e retorna somente dígitos", () => {
    expect(normalizarNCM("2201.10.00")).toBe("22011000");
    expect(normalizarNCM(null)).toBe("");
  });
});

describe("calcularScoreNCM (dígito-a-dígito)", () => {
  it("todos os dígitos compatíveis → 100 e ncm_compativel", () => {
    const r = calcularScoreNCM("22011000", "2201");
    expect(r.ncm_compativel).toBe(true);
    expect(r.score_ncm).toBe(100);
    expect(r.nivel_correspondencia).toBe("POSICAO");
    expect(r.primeiro_conflito).toBeNull();
  });

  it("divergência no 3º dígito bloqueia e reporta posição", () => {
    const r = calcularScoreNCM("22111000", "2201");
    expect(r.ncm_compativel).toBe(false);
    expect(r.primeiro_conflito.posicao).toBe(3);
    expect(r.score_ncm).toBeLessThan(100);
  });

  it("divergência no 5º dígito de regra com 6 dígitos", () => {
    const r = calcularScoreNCM("22011000", "220210");
    expect(r.ncm_compativel).toBe(false);
    expect(r.primeiro_conflito.posicao).toBe(4);
  });

  it("divergência no 8º dígito com regra de 8", () => {
    const r = calcularScoreNCM("39211201", "39211200");
    expect(r.ncm_compativel).toBe(false);
    expect(r.primeiro_conflito.posicao).toBe(8);
  });

  it("regras com 4, 6 e 8 dígitos calibram nivel_correspondencia", () => {
    expect(calcularScoreNCM("22011000","2201").nivel_correspondencia).toBe("POSICAO");
    expect(calcularScoreNCM("22021000","220210").nivel_correspondencia).toBe("SUBPOSICAO");
    expect(calcularScoreNCM("39211200","39211200").nivel_correspondencia).toBe("ITEM");
  });
});

describe("calcularScoreDescricao", () => {
  const r = REGRAS_TESTE[0];
  it("aceita descrição comercial equivalente com palavra obrigatória", () => {
    const s = calcularScoreDescricao("Água mineral natural 500ml sem gás", r);
    expect(s.compativel).toBe(true);
  });
  it("reprova quando termo excludente está presente", () => {
    const s = calcularScoreDescricao("Água destilada para bateria", r);
    expect(s.compativel).toBe(false);
  });
  it("reprova quando palavra obrigatória está ausente", () => {
    const s = calcularScoreDescricao("Refrigerante sabor limão 2L", r);
    expect(s.compativel).toBe(false);
  });
});

describe("classificarProduto — pipeline", () => {
  it("NCM+descrição compatíveis → ST_CONFIRMADA", () => {
    const r = classificarProduto({
      ncm: "22011000", descricao: "Água mineral natural 500ml",
      cest: "0300300", cst: "10", ufOrigem: "SP", ufDestino: "BA",
    });
    expect(r.status).toBe("ST_CONFIRMADA");
    expect(r.regra.id).toBe("R_2201");
  });

  it("mesmo NCM mas descrição diferente → NCM soberano confirma o ST", () => {
    const r = classificarProduto({
      ncm: "22011000", descricao: "Água destilada para bateria automotiva",
      cst: "10", ufOrigem: "SP", ufDestino: "BA",
    });
    // Regra 2026: o NCM é a métrica principal — descrição/CEST não negam o
    // enquadramento quando todos os dígitos legislados coincidem.
    expect(["ST_CONFIRMADA","ST_CONFIRMADA_MVA_PENDENTE","REVISAO_NECESSARIA"]).toContain(r.status);
  });

  it("divergência de NCM impede confirmação", () => {
    const r = classificarProduto({
      ncm: "22111000", descricao: "Água mineral",
      cst: "10", ufOrigem: "SP", ufDestino: "BA",
    });
    expect(r.status).not.toBe("ST_CONFIRMADA");
  });

  it("sem CEST mas NCM+descrição batem → ainda confirma", () => {
    const r = classificarProduto({
      ncm: "22011000", descricao: "Água mineral em garrafa",
      cst: "10", ufOrigem: "SP", ufDestino: "BA",
    });
    expect(r.status).toBe("ST_CONFIRMADA");
  });

  it("descrição comercial abreviada equivalente é aceita via sinônimo", () => {
    const r = classificarProduto({
      ncm: "22021000", descricao: "Refri cola 350ml",
      cst: "10", ufOrigem: "SP", ufDestino: "BA",
    });
    expect(r.status).toBe("ST_CONFIRMADA");
  });

  it("UF não signatária bloqueia por acordo", () => {
    const r = classificarProduto({
      ncm: "22011000", descricao: "Água mineral",
      cst: "10", ufOrigem: "MG", ufDestino: "BA",
    });
    expect(r.status).not.toBe("ST_CONFIRMADA");
  });

  it("CST 60 marca bloqueio de cálculo mesmo com NCM compatível", () => {
    const r = classificarProduto({
      ncm: "22011000", descricao: "Água mineral 500ml",
      cst: "60", ufOrigem: "SP", ufDestino: "BA",
    });
    expect(r.bloqueio_cst?.bloqueia).toBe(true);
    expect(r.status).toBe("REVISAO_NECESSARIA");
  });

  it("NCM sem regra retorna SEM_REGRA_POR_NCM", () => {
    const r = classificarProduto({
      ncm: "99999999", descricao: "Produto genérico",
      cst: "00", ufOrigem: "SP", ufDestino: "BA",
    });
    expect(r.status).toBe("SEM_REGRA_POR_NCM");
  });
});
