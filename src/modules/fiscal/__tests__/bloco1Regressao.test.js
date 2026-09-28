import { describe, it, expect } from "vitest";
import {
  classificarProduto,
  registroRegras,
  _resetRegistroParaTeste,
} from "../engines/motorClassificacaoST";
import { interpretarCST } from "../engines/motorCST";
import { matchConvenioEstrito } from "../engines/motorConvenio";
import { parseVersoesTexto, extrairUfsDeTexto } from "../engines/vigenciaUf";

// Testes de regressão dos bugs corrigidos no Bloco 1.
// Usam a BASE REAL (Anexo 1 do RICMS/BA) — não regras sintéticas.

describe("1.1 — desambiguação de itens que compartilham o mesmo NCM", () => {
  it("água mineral em jarra descartável (NCM 2201) resolve para o item 3.5.2 / CEST 03.005.02", () => {
    _resetRegistroParaTeste(null);
    const r = classificarProduto({
      ncm: "22011000",
      descricao: "Água mineral natural em jarra descartável 20L",
      cst: "00",
      ufOrigem: "PR",
      ufDestino: "BA",
      dataFatoGerador: "2026-08-01",
    });
    expect(r.regra).not.toBeNull();
    expect(r.regra.item_ricms).toBe("3.5.2");
    expect(r.regra.cest).toBe("03.005.02");
  });

  it("água em embalagem de vidro descartável NÃO cai no item de copo plástico", () => {
    _resetRegistroParaTeste(null);
    const r = classificarProduto({
      ncm: "22011000",
      descricao: "Água mineral natural em embalagem de vidro descartável 300ml",
      cst: "00",
      ufOrigem: "MG",
      ufDestino: "BA",
      dataFatoGerador: "2026-08-01",
    });
    expect(r.regra?.cest).not.toBe("03.005.00");
  });

  it("a base real passa a ter palavras obrigatórias/excludentes derivadas", () => {
    _resetRegistroParaTeste(null);
    const reg = registroRegras();
    const jarra = reg.find((x) => x.item_ricms === "3.5.2" && x.versao === 0);
    expect(jarra.palavras_obrigatorias).toContain("jarra");
    expect(jarra.palavras_excludentes).toContain("copo");
  });
});

describe("1.2 — versionamento temporal por data do fato gerador", () => {
  it("parseVersoesTexto separa redação atual e anterior com janelas distintas", () => {
    const txt =
      'Todos, exceto MG e SP Nota: … efeitos a partir de 01/07/26. Redação anterior, efeitos até 30/06/26. “Todos, exceto MG”';
    const vs = parseVersoesTexto(txt);
    expect(vs).toHaveLength(2);
    expect(vs[0].vigencia_inicio.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(vs[1].vigencia_fim.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(extrairUfsDeTexto(vs[0].trecho).ufs).toContain("SP");
    expect(extrairUfsDeTexto(vs[1].trecho).ufs).not.toContain("SP");
  });

  it("Prot. ICM 11/91 — SP signatário em 01/05/2026 e excluído em 01/08/2026", () => {
    _resetRegistroParaTeste(null);
    const entrada = {
      ncm: "22011000",
      descricao: "Água mineral natural em embalagem de vidro descartável",
      cst: "00",
      ufOrigem: "BA",
      ufDestino: "SP",
    };
    const antes = classificarProduto({ ...entrada, dataFatoGerador: "2026-05-01" });
    const depois = classificarProduto({ ...entrada, dataFatoGerador: "2026-08-01" });

    // Antes do Despacho CONFAZ 26/2026, SP era signatário → regra aplicável.
    expect(antes.regra?.item_ricms).toBe("3.3");
    expect(antes.regra.ufs_signatarias.ufs).not.toContain("SP");

    // A partir de 01/07/26, SP foi excluído → destino SP não enquadra.
    expect(depois.regra?.item_ricms).not.toBe("3.3");
  });
});

describe("1.3 — CSOSN reativado", () => {
  it("CSOSN 500 equivale ao CST 60: novo cálculo de ST vedado", () => {
    const p = interpretarCST("500");
    expect(p.origem_codigo).toBe("CSOSN");
    expect(p.stRetidaAnterior).toBe(true);
    expect(p.temST).toBe(false);
    expect(p.calculosProibidos).toContain("ICMS_ST_NOVO");
  });

  it("CSOSN 500 bloqueia a classificação automática de ST", () => {
    _resetRegistroParaTeste(null);
    const r = classificarProduto({
      ncm: "22011000",
      descricao: "Água mineral natural em jarra descartável",
      cst: "500",
      ufOrigem: "SP",
      ufDestino: "BA",
      dataFatoGerador: "2026-08-01",
    });
    expect(r.bloqueio_cst?.bloqueia).toBe(true);
    expect(r.status).not.toBe("ST_CONFIRMADA");
  });

  it("CSOSN 400 equivale ao CST 41: nenhum cálculo permitido", () => {
    const p = interpretarCST("400");
    expect(p.naoTributado).toBe(true);
    for (const c of ["ICMS_PROPRIO", "ICMS_ST", "DIFAL", "ANTECIPACAO"]) {
      expect(p.calculosProibidos).toContain(c);
    }
  });

  it("CSOSN não mapeado ainda cai no fallback CST 90 com aviso", () => {
    const p = interpretarCST("999");
    expect(p.origem_codigo).toBe("CSOSN_DESCONHECIDO");
    expect(p.codigo).toBe("90");
  });
});

describe("1.4 — Convênio com NCM de posição (4 dígitos)", () => {
  const regra4 = {
    ncm: "8433",
    descricao: "Máquinas e aparelhos para colheita",
    fundamento: "Convênio ICMS 52/91",
  };

  it("regra de 4 dígitos casa com produto de 8 dígitos compatível", () => {
    const r = matchConvenioEstrito(
      { ncm: "84335129", descricao: "Máquina de colheita automotriz" },
      regra4,
    );
    expect(r.ncmExato).toBe(true);
    expect(r.digitos_regra).toBe(4);
    expect(r.nivel_correspondencia).toBe("POSICAO");
    expect(r.enquadrado).toBe(true);
  });

  it("regra de 4 dígitos NÃO casa com produto de posição diferente", () => {
    const r = matchConvenioEstrito(
      { ncm: "84295219", descricao: "Escavadeira hidráulica" },
      regra4,
    );
    expect(r.ncmExato).toBe(false);
    expect(r.enquadrado).toBe(false);
  });

  it("regra de 8 dígitos continua exigindo os 8 dígitos", () => {
    const regra8 = { ncm: "84335129", descricao: "Colheitadeira", fundamento: "Convênio ICMS 52/91" };
    expect(matchConvenioEstrito({ ncm: "84335119", descricao: "Colheitadeira" }, regra8).enquadrado).toBe(false);
    expect(matchConvenioEstrito({ ncm: "84335129", descricao: "Colheitadeira de grãos" }, regra8).enquadrado).toBe(true);
  });
});
