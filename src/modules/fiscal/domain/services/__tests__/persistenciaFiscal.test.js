import { afterEach, describe, expect, it, vi } from "vitest";

function navegadorSimulado() {
  const registros = new Map();
  const legado = new Map();
  let criada = false;
  const banco = {
    objectStoreNames: { contains: () => criada },
    createObjectStore: () => { criada = true; },
    transaction: () => {
      const transaction = { error: null, oncomplete: null, onerror: null, onabort: null };
      transaction.objectStore = () => ({
        get: chave => {
          const request = { result: undefined, error: null, onsuccess: null, onerror: null };
          queueMicrotask(() => { request.result = registros.get(chave); request.onsuccess?.(); });
          return request;
        },
        put: (dados, chave) => {
          queueMicrotask(() => { registros.set(chave, structuredClone(dados)); transaction.oncomplete?.(); });
        },
      });
      return transaction;
    },
  };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request = { result: banco, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: chave => legado.get(chave) ?? null,
    setItem: (chave, dados) => legado.set(chave, String(dados)),
  });
  return { registros, legado };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("persistência de notas e histórico", () => {
  it("migra o Arquivo Fiscal antigo sem apagá-lo e não volta ao estado vazio após reabrir", async () => {
    const { legado } = navegadorSimulado();
    const antigo = { EMPRESA: { registros: [{ id: "chave", numero: "123" }] } };
    legado.set("fiscoai:arquivo:v1", JSON.stringify(antigo));
    const { ArquivoFiscalService } = await import("../ArquivoFiscalService");
    expect(await ArquivoFiscalService.load()).toEqual(antigo);
    legado.set("fiscoai:arquivo:v1", "{}");
    vi.resetModules();
    const { ArquivoFiscalService: reaberto } = await import("../ArquivoFiscalService");
    expect(await reaberto.load()).toEqual(antigo);
  });

  it("mantém o histórico completo, incluindo XML, após nova sessão", async () => {
    navegadorSimulado();
    const { HistoricoImportacaoService } = await import("../HistoricoImportacaoService");
    const historico = Array.from({ length: 65 }, (_, i) => ({ id: i, xml: `<NFe>${i}</NFe>`, nota: { numero: String(i) } }));
    await HistoricoImportacaoService.save(historico);
    vi.resetModules();
    const { HistoricoImportacaoService: reaberto } = await import("../HistoricoImportacaoService");
    expect(await reaberto.load()).toEqual(historico);
  });

  it("mantém uma única entrada ao reimportar a mesma NF-e, inclusive em lote", async () => {
    navegadorSimulado();
    const { HistoricoImportacaoService, mesclarHistorico } = await import("../HistoricoImportacaoService");
    const entradas = ["ICMS_ST", "REDUCAO_BC", "DIFAL"].map((tributacao, i) => ({
      id: i + 1,
      nota: { chave: `NFe${String(i + 1).padStart(44, "0")}`, numero: String(i + 1) },
      produtos: [{ tributacao }],
      calculos: [{ tributacao }],
      xml: `<NFe>${i + 1}</NFe>`,
    }));
    const reimportada = { ...entradas[0], id: 99, calculos: [{ tributacao: "ICMS_ST", revisado: true }] };
    const historico = mesclarHistorico(entradas, [reimportada, entradas[1], reimportada]);
    expect(historico).toHaveLength(3);
    expect(historico[0].id).toBe(1);
    expect(historico[0].calculos[0].revisado).toBe(true);
    await HistoricoImportacaoService.save(historico);
    vi.resetModules();
    const { HistoricoImportacaoService: reaberto } = await import("../HistoricoImportacaoService");
    expect(await reaberto.load()).toHaveLength(3);
  });

  it("remove duplicatas antigas sem confundir notas com mesmo número de emitentes distintos", async () => {
    const { registros } = navegadorSimulado();
    const nota = { emitente_cnpj: "12345678000199", numero: "10", serie: "1", data_emissao: "2026-10-16T10:00:00" };
    registros.set("historico-importacao", [
      { id: 1, nota, xml: "<NFe>original</NFe>" },
      { id: 2, nota, xml: "<NFe>duplicada</NFe>" },
      { id: 3, nota: { ...nota, emitente_cnpj: "98765432000100" }, xml: "<NFe>outra</NFe>" },
    ]);
    const { HistoricoImportacaoService } = await import("../HistoricoImportacaoService");
    const historico = await HistoricoImportacaoService.load();
    expect(historico.map(entrada => entrada.id)).toEqual([1, 3]);
    expect(registros.get("historico-importacao").map(entrada => entrada.id)).toEqual([1, 3]);
  });

  it("grava alterações rápidas na ordem e preserva a última versão", async () => {
    navegadorSimulado();
    const { ArquivoFiscalService } = await import("../ArquivoFiscalService");
    await Promise.all([
      ArquivoFiscalService.save({ EMPRESA: { registros: [{ id: "1" }] } }),
      ArquivoFiscalService.save({ EMPRESA: { registros: [{ id: "1" }, { id: "2" }] } }),
    ]);
    expect(await ArquivoFiscalService.load()).toEqual({ EMPRESA: { registros: [{ id: "1" }, { id: "2" }] } });
  });

  it("não esconde falha de gravação quando o navegador fica sem espaço", async () => {
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("quota excedida"); },
    });
    const { ArquivoFiscalService } = await import("../ArquivoFiscalService");
    await expect(ArquivoFiscalService.save({ EMPRESA: { registros: [] } })).rejects.toThrow("quota excedida");
  });
});
