// Bloco 1.5 — desambiguação por referência externa / atributo de negócio
import { describe, it, expect, beforeEach } from "vitest";
import {
  classificarProduto,
  registroRegras,
  _resetRegistroParaTeste,
  modoDesambiguacaoDoItem,
  detectarGrupoHomogeneoNaoTextual,
} from "../engines/motorClassificacaoST.js";
import { resolverPorReferenciaExterna } from "../engines/resolverReferenciaExterna.js";
import { _registrarReferenciaParaTeste } from "../data/listasMedicamentos.js";

const ANESTESICO = {
  ncm: "30049043",
  descricao:
    "ANESTESICO LIDOSTESIM AD C/50 DLA PHARMACEUTICAL - LOTE: S08913AA DT. VALID.: 01/12/2027",
};

beforeEach(() => {
  _resetRegistroParaTeste(null);
  _registrarReferenciaParaTeste([]);
});

describe("modo de desambiguação", () => {
  it("marca medicamentos como REFERENCIA_EXTERNA e autopeças 1.1 como ATRIBUTO_NEGOCIO", () => {
    expect(modoDesambiguacaoDoItem("9.2.0")).toBe("REFERENCIA_EXTERNA");
    expect(modoDesambiguacaoDoItem("9.1.1")).toBe("REFERENCIA_EXTERNA");
    expect(modoDesambiguacaoDoItem("1.1")).toBe("ATRIBUTO_NEGOCIO");
    expect(modoDesambiguacaoDoItem("3.3.1")).toBe("TEXTUAL");
  });
});

describe("ST_CONFIRMADA_MVA_PENDENTE", () => {
  it("classifica o anestésico como ST com sub-item pendente", () => {
    const r = classificarProduto(ANESTESICO);
    expect(r.status).toBe("ST_CONFIRMADA_MVA_PENDENTE");
    expect(r.modo_desambiguacao).toBe("REFERENCIA_EXTERNA");
    expect(r.candidatos_mva.length).toBeGreaterThanOrEqual(9);
    expect(r.candidatos_mva.every((c) => /^9\./.test(c.item_ricms))).toBe(true);
    expect(r.mva_faixa.minima).toBeLessThanOrEqual(r.mva_faixa.maxima);
    expect(r.dado_necessario).toMatch(/ANVISA|GTIN/);
  });

  it("resolve o sub-item quando há GTIN cadastrado na referência externa", () => {
    _registrarReferenciaParaTeste([
      {
        chave: "7899999999999",
        item_ricms_esperado: "9.2.0",
        lista: "POSITIVA",
        classe: "GENERICO",
        fonte: "mock de teste",
      },
    ]);
    const pendente = classificarProduto(ANESTESICO);
    const r = resolverPorReferenciaExterna(pendente, { gtin: "7899999999999" });
    expect(r.status).toBe("ST_CONFIRMADA");
    expect(r.regra.item_ricms).toBe("9.2.0");
    expect(r.motivo).toMatch(/referência externa/i);
  });

  it("mantém pendente quando não há chave externa ou cadastro", () => {
    const pendente = classificarProduto(ANESTESICO);
    expect(resolverPorReferenciaExterna(pendente, {}).status).toBe("ST_CONFIRMADA_MVA_PENDENTE");
    expect(
      resolverPorReferenciaExterna(pendente, { gtin: "0000000000000" }).status,
    ).toBe("ST_CONFIRMADA_MVA_PENDENTE");
  });

  // O Anexo 1 vigente carregado não traz o segmento de autopeças (item 1.1),
  // então o comportamento ATRIBUTO_NEGOCIO é validado no detector diretamente.
  it("grupo de autopeças (1.1 / fidelidade) é detectado como ATRIBUTO_NEGOCIO", () => {
    const membro = (id) => ({
      regra: {
        id,
        item_ricms: "1.1",
        tipo: "ICMS_ST",
        grupo_id: "ATRIBUTO_NEGOCIO:1:8708",
        modo_desambiguacao: "ATRIBUTO_NEGOCIO",
      },
      scoreNCM: { ncm_compativel: true, nivel_correspondencia: "POSICAO" },
    });
    const g = detectarGrupoHomogeneoNaoTextual([], [membro("A"), membro("B")]);
    expect(g).not.toBeNull();
    expect(g.modo_desambiguacao).toBe("ATRIBUTO_NEGOCIO");
    expect(g.candidatos).toHaveLength(2);
  });

  it("não aplica o atalho quando dois grupos distintos disputam o produto", () => {
    const m = (grupo) => ({
      regra: { id: grupo, tipo: "ICMS_ST", grupo_id: grupo, modo_desambiguacao: "REFERENCIA_EXTERNA" },
      scoreNCM: { ncm_compativel: true, nivel_correspondencia: "ITEM" },
    });
    expect(detectarGrupoHomogeneoNaoTextual([], [m("G1"), m("G2")])).toBeNull();
  });

  it("não aciona o atalho em segmento TEXTUAL (água mineral)", () => {
    const r = classificarProduto({
      ncm: "22011000",
      descricao: "AGUA MINERAL NATURAL SEM GAS GARRAFA VIDRO 300ML",
    });
    expect(r.status).not.toBe("ST_CONFIRMADA_MVA_PENDENTE");
  });
});

describe("deduplicação da base", () => {
  it("registroRegras() não retorna dois registros vigentes com o mesmo CEST", () => {
    const vistos = new Map();
    for (const r of registroRegras()) {
      if (!r.cest || r.versao !== 0) continue;
      const k = String(r.cest).replace(/\D/g, "");
      expect(vistos.has(k), `CEST duplicado: ${k} (${vistos.get(k)} × ${r.id})`).toBe(false);
      vistos.set(k, r.id);
    }
  });
});
