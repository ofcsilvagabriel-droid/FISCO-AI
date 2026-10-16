// Dados volumosos de notas não cabem de forma confiável no localStorage.
// O IndexedDB é a fonte atual; chaves antigas são migradas sem apagá-las.
const DATABASE = "fiscoai:fiscal:v1";
const STORE = "snapshots";
let abertura: Promise<IDBDatabase> | null = null;
const gravacoes = new Map<string, Promise<void>>();

function abrirBanco(): Promise<IDBDatabase> {
  if (!abertura) {
    abertura = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento fiscal."));
    });
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

async function gravarBanco(chave: string, dados: unknown): Promise<void> {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(dados, chave);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Não foi possível salvar os dados fiscais."));
    transaction.onabort = () => reject(transaction.error || new Error("A gravação dos dados fiscais foi interrompida."));
  });
}

function lerLegado<T>(chave: string, vazio: T): T {
  const raw = localStorage.getItem(chave);
  return raw === null ? vazio : JSON.parse(raw) as T;
}

export async function carregarFiscal<T>(chave: string, chaveLegada: string, vazio: T): Promise<T> {
  await gravacoes.get(chave);
  if (typeof indexedDB === "undefined") return lerLegado(chaveLegada, vazio);
  const salvo = await lerBanco(chave);
  if (salvo !== undefined) return salvo as T;
  const legado = lerLegado(chaveLegada, vazio);
  if (localStorage.getItem(chaveLegada) !== null) await gravarBanco(chave, legado);
  return legado;
}

export function salvarFiscal(chave: string, chaveLegada: string, dados: unknown): Promise<void> {
  const anterior = gravacoes.get(chave) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(() => {
    if (typeof indexedDB === "undefined") {
      localStorage.setItem(chaveLegada, JSON.stringify(dados));
      return;
    }
    return gravarBanco(chave, dados);
  });
  gravacoes.set(chave, atual);
  return atual.finally(() => {
    if (gravacoes.get(chave) === atual) gravacoes.delete(chave);
  });
}
