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
