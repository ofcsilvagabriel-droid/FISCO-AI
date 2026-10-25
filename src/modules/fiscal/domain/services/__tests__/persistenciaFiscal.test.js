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
  vi.unstubAllEnvs();
  vi.doUnmock("../PersistenciaFiscalNuvem");
  vi.doUnmock("@/integrations/supabase/client");
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

  it("recupera Arquivo Fiscal e Histórico da nuvem quando o navegador perde o IndexedDB", async () => {
    const { registros } = navegadorSimulado();
    const remotos = new Map();
    vi.doMock("../PersistenciaFiscalNuvem", () => ({
      carregarDaNuvem: async tipo => remotos.get(tipo) || null,
      salvarNaNuvem: async (tipo, dados, versao) => { remotos.set(tipo, { dados: structuredClone(dados), versao }); },
    }));
    const { ArquivoFiscalService } = await import("../ArquivoFiscalService");
    const { HistoricoImportacaoService } = await import("../HistoricoImportacaoService");
    const arquivo = { EMPRESA: { registros: [{ id: "nota-ST", produtos: [{ tributacao: "ICMS_ST" }] }] } };
    const historico = [{ id: 1, nota: { chave: `NFe${"1".padStart(44, "0")}` }, xml: "<NFe/>" }];
    await ArquivoFiscalService.save(arquivo);
    await HistoricoImportacaoService.save(historico);
    registros.clear();
    vi.resetModules();
    const { ArquivoFiscalService: arquivoReaberto } = await import("../ArquivoFiscalService");
    const { HistoricoImportacaoService: historicoReaberto } = await import("../HistoricoImportacaoService");
    expect(await arquivoReaberto.load()).toEqual(arquivo);
    expect(await historicoReaberto.load()).toEqual(historico);
  });

  it("mescla registros antigos sem versão com a cópia já existente na nuvem", async () => {
    const { registros } = navegadorSimulado();
    registros.set("arquivo", { EMPRESA: { registros: [{ id: "local", numero: "1" }] } });
    const remoto = { EMPRESA: { registros: [{ id: "remoto", numero: "2" }] } };
    const remotos = new Map([["arquivo", { dados: remoto, versao: 123 }]]);
    vi.doMock("../PersistenciaFiscalNuvem", () => ({
      carregarDaNuvem: async tipo => remotos.get(tipo) || null,
      salvarNaNuvem: async (tipo, dados, versao) => { remotos.set(tipo, { dados, versao }); },
    }));
    const { ArquivoFiscalService } = await import("../ArquivoFiscalService");
    const dados = await ArquivoFiscalService.load();
    expect(dados.EMPRESA.registros.map(registro => registro.id)).toEqual(["remoto", "local"]);
    expect(remotos.get("arquivo").dados).toEqual(dados);
  });

  it("preserva o espelho local e impede sobrescrever a nuvem quando a leitura remota falha", async () => {
    const { registros } = navegadorSimulado();
    const antigo = { EMPRESA: { registros: [{ id: "antigo" }] } };
    registros.set("arquivo", antigo);
    vi.doMock("../PersistenciaFiscalNuvem", () => ({
      carregarDaNuvem: async () => { throw new Error("sem conexão"); },
      salvarNaNuvem: async () => { throw new Error("não deveria gravar"); },
    }));
    const { ArquivoFiscalService } = await import("../ArquivoFiscalService");
    const { avisoSincronizacaoFiscal } = await import("../PersistenciaFiscalLocal");
    expect(await ArquivoFiscalService.load()).toEqual(antigo);
    expect(avisoSincronizacaoFiscal()).toContain("sem conexão");
    const novo = { EMPRESA: { registros: [{ id: "antigo" }, { id: "novo" }] } };
    await expect(ArquivoFiscalService.save(novo)).rejects.toThrow("versão na nuvem não foi verificada");
    expect(registros.get("arquivo")).toEqual(novo);
  });

  it("mostra a mensagem real do Supabase quando a falha não é uma instância de Error", async () => {
    navegadorSimulado();
    vi.doMock("../PersistenciaFiscalNuvem", () => ({
      carregarDaNuvem: async () => { throw { code: "42501", message: "acesso negado" }; },
      salvarNaNuvem: async () => {},
    }));
    const { ArquivoFiscalService } = await import("../ArquivoFiscalService");
    const { avisoSincronizacaoFiscal } = await import("../PersistenciaFiscalLocal");
    await ArquivoFiscalService.load();
    expect(avisoSincronizacaoFiscal()).toContain("42501 — acesso negado");
    expect(avisoSincronizacaoFiscal()).not.toContain("[object Object]");
  });

  it("renova a sessão e repete leitura e gravação uma vez após 401", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const consultar = vi.fn()
      .mockResolvedValueOnce({ status: 401, error: { message: "JWT expirado" } })
      .mockResolvedValueOnce({ status: 200, data: { dados: { teste: true }, versao: 2 }, error: null });
    const gravar = vi.fn()
      .mockResolvedValueOnce({ status: 401, error: { message: "JWT expirado" } })
      .mockResolvedValueOnce({ status: 201, error: null });
    const renovar = vi.fn().mockResolvedValue({ error: null });
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "usuario" } } }, error: null }), refreshSession: renovar },
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: consultar }) }) }),
        upsert: gravar,
      }),
    } }));
    const { carregarDaNuvem, salvarNaNuvem } = await import("../PersistenciaFiscalNuvem");
    expect(await carregarDaNuvem("arquivo")).toEqual({ dados: { teste: true }, versao: 2 });
    await salvarNaNuvem("arquivo", { teste: true }, 2);
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(gravar).toHaveBeenCalledTimes(2);
    expect(renovar).toHaveBeenCalledTimes(2);
  });

  it("recupera a Memória Protegida da nuvem após perder os dados do navegador", async () => {
    const { registros, legado } = navegadorSimulado();
    const remotos = new Map();
    vi.doMock("../PersistenciaFiscalNuvem", () => ({
      carregarDaNuvem: async tipo => remotos.get(tipo) || null,
      salvarNaNuvem: async (tipo, dados, versao) => { remotos.set(tipo, { dados: structuredClone(dados), versao }); },
    }));
    vi.stubGlobal("window", { dispatchEvent: () => {} });
    const { HistoricoApuracaoService } = await import("../HistoricoApuracaoService");
    await HistoricoApuracaoService.sincronizar();
    HistoricoApuracaoService.salvarHistoricoNCM({
      ncm: "00000000", empresa_id: "EMPRESA_TESTE", apuracoes: [], atualizado_em: "2026-10-25T00:00:00Z",
    });
    await vi.waitFor(() => expect(remotos.get("memoria-protegida")?.dados?.["EMPRESA_TESTE::00000000"]).toBeDefined());
    registros.clear();
    legado.clear();
    vi.resetModules();
    const { HistoricoApuracaoService: reaberto } = await import("../HistoricoApuracaoService");
    await reaberto.sincronizar();
    expect(reaberto.buscarHistoricoNCM("00000000", "EMPRESA_TESTE")?.empresa_id).toBe("EMPRESA_TESTE");
  });
});
