// Dados volumosos de notas não cabem de forma confiável no localStorage.
// O IndexedDB é o espelho local; chaves antigas são migradas sem apagá-las.
import { carregarDaNuvem, salvarNaNuvem } from "./PersistenciaFiscalNuvem";

const DATABASE = "fiscoai:fiscal:v1";
const STORE = "snapshots";
let abertura: Promise<IDBDatabase> | null = null;
const gravacoes = new Map<string, Promise<void>>();
const versoes = new Map<string, number>();
const avisosNuvem = new Map<string, string>();
const sincronizacaoBloqueada = new Set<string>();

export function avisoSincronizacaoFiscal(): string | null { return [...avisosNuvem.values()].join(" ") || null; }

function abrirBanco(): Promise<IDBDatabase> {
  if (!abertura) {
    abertura = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); abertura = null; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento fiscal."));
    }).catch(error => { abertura = null; throw error; });
  }
  return abertura;
}

async function lerBanco(chave: string): Promise<unknown> {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(chave);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Não foi possível ler os dados fiscais."));
  });
}

async function gravarBanco(chave: string, dados: unknown, versao: number): Promise<void> {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(dados, chave);
    transaction.objectStore(STORE).put(versao, `versao:${chave}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Não foi possível salvar os dados fiscais."));
    transaction.onabort = () => reject(transaction.error || new Error("A gravação dos dados fiscais foi interrompida."));
  });
}

function lerLegado<T>(chave: string, vazio: T): T {
  const raw = localStorage.getItem(chave);
  return raw === null ? vazio : JSON.parse(raw) as T;
}

export async function carregarFiscal<T>(chave: string, chaveLegada: string, vazio: T, mesclarLegado?: (remoto: T, local: T) => T): Promise<T> {
  await gravacoes.get(chave);
  let local: T;
  let versao = 0;
  let temDadosLocais = false;
  if (typeof indexedDB === "undefined") {
    const legado = localStorage.getItem(chaveLegada);
    local = legado === null ? vazio : JSON.parse(legado) as T;
    temDadosLocais = legado !== null;
    versao = Number(localStorage.getItem(`fiscoai:versao:${chave}`)) || 0;
  } else {
    const salvo = await lerBanco(chave);
    versao = Number(await lerBanco(`versao:${chave}`)) || 0;
    local = salvo === undefined ? lerLegado(chaveLegada, vazio) : salvo as T;
    temDadosLocais = salvo !== undefined || localStorage.getItem(chaveLegada) !== null;
    if (salvo === undefined && temDadosLocais) await gravarBanco(chave, local, versao);
  }
  versoes.set(chave, versao);
  try {
    const remoto = await carregarDaNuvem(chave);
    if (remoto && versao === 0 && temDadosLocais && mesclarLegado) {
      const combinado = mesclarLegado(remoto.dados as T, local);
      const novaVersao = Date.now();
      local = combinado;
      versao = novaVersao;
      if (typeof indexedDB === "undefined") {
        localStorage.setItem(chaveLegada, JSON.stringify(combinado));
        localStorage.setItem(`fiscoai:versao:${chave}`, String(novaVersao));
      } else await gravarBanco(chave, combinado, novaVersao);
      versoes.set(chave, novaVersao);
      await salvarNaNuvem(chave, combinado, novaVersao);
      avisosNuvem.delete(chave);
      sincronizacaoBloqueada.delete(chave);
      return combinado;
    }
    if (remoto && remoto.versao >= versao) {
      if (typeof indexedDB === "undefined") {
        localStorage.setItem(chaveLegada, JSON.stringify(remoto.dados));
        localStorage.setItem(`fiscoai:versao:${chave}`, String(remoto.versao));
      } else await gravarBanco(chave, remoto.dados, remoto.versao);
      versoes.set(chave, remoto.versao);
      avisosNuvem.delete(chave);
      sincronizacaoBloqueada.delete(chave);
      return remoto.dados as T;
    }
    if (temDadosLocais) {
      await salvarNaNuvem(chave, local, versao || Date.now());
    }
    avisosNuvem.delete(chave);
    sincronizacaoBloqueada.delete(chave);
  } catch (error) {
    avisosNuvem.set(chave, `Não foi possível sincronizar ${chave} na nuvem: ${error instanceof Error ? error.message : String(error)}`);
    sincronizacaoBloqueada.add(chave);
  }
  return local;
}

export function salvarFiscal(chave: string, chaveLegada: string, dados: unknown): Promise<void> {
  const anterior = gravacoes.get(chave) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(async () => {
    const versao = Math.max(Date.now(), (versoes.get(chave) || 0) + 1);
    if (typeof indexedDB === "undefined") {
      localStorage.setItem(chaveLegada, JSON.stringify(dados));
      localStorage.setItem(`fiscoai:versao:${chave}`, String(versao));
    } else {
      await gravarBanco(chave, dados, versao);
    }
    versoes.set(chave, versao);
    try {
      if (sincronizacaoBloqueada.has(chave)) throw new Error("A versão na nuvem não foi verificada. Recarregue a página quando a conexão voltar.");
      await salvarNaNuvem(chave, dados, versao);
      avisosNuvem.delete(chave);
    } catch (error) {
      avisosNuvem.set(chave, `Dados de ${chave} salvos neste navegador, mas não na nuvem: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
  gravacoes.set(chave, atual);
  return atual.finally(() => {
    if (gravacoes.get(chave) === atual) gravacoes.delete(chave);
  });
}
