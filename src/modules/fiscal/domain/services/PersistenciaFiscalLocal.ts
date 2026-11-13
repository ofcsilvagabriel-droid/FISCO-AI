// Visitantes usam apenas a sessão da aba. Usuários autenticados recebem um
// espelho IndexedDB isolado pelo ID da conta e sincronizado com o Supabase.
import { carregarDaNuvem, salvarNaNuvem, usuarioFiscal } from "./PersistenciaFiscalNuvem";

const DATABASE = "fiscoai:fiscal:v1";
const STORE = "snapshots";
const PREFIXO_VISITANTE = "fiscoai:visitante:";
let abertura: Promise<IDBDatabase> | null = null;
const gravacoes = new Map<string, Promise<void>>();
const versoes = new Map<string, number>();
const avisosNuvem = new Map<string, string>();
const sincronizacaoBloqueada = new Set<string>();
const sessaoVolatil = new Map<string, string>();

export function avisoSincronizacaoFiscal(): string | null {
  return [...avisosNuvem.values()].join(" ") || null;
}

function mensagemErro(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const detalhe = error as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const partes = [detalhe.code, detalhe.message, detalhe.details, detalhe.hint].filter(
      (valor) => typeof valor === "string" && valor.trim(),
    );
    if (partes.length) return partes.join(" — ");
  }
  return String(error);
}

function abrirBanco(): Promise<IDBDatabase> {
  if (!abertura) {
    abertura = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          abertura = null;
        };
        resolve(request.result);
      };
      request.onerror = () =>
        reject(request.error || new Error("Não foi possível abrir o armazenamento fiscal."));
    }).catch((error) => {
      abertura = null;
      throw error;
    });
  }
  return abertura;
}

async function lerBanco(chave: string): Promise<unknown> {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(chave);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Não foi possível ler os dados fiscais."));
  });
}

async function gravarBanco(chave: string, dados: unknown, versao: number): Promise<void> {
  const db = await abrirBanco();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(dados, chave);
    transaction.objectStore(STORE).put(versao, `versao:${chave}`);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Não foi possível salvar os dados fiscais."));
    transaction.onabort = () =>
      reject(transaction.error || new Error("A gravação dos dados fiscais foi interrompida."));
  });
}

function lerSessao<T>(chave: string, vazio: T): T {
  const storage = typeof sessionStorage === "undefined" ? null : sessionStorage;
  const raw = storage?.getItem(`${PREFIXO_VISITANTE}${chave}`) ?? sessaoVolatil.get(chave) ?? null;
  return raw === null ? vazio : (JSON.parse(raw) as T);
}

function gravarSessao(chave: string, dados: unknown) {
  const serializado = JSON.stringify(dados);
  if (typeof sessionStorage === "undefined") sessaoVolatil.set(chave, serializado);
  else sessionStorage.setItem(`${PREFIXO_VISITANTE}${chave}`, serializado);
}

const chaveUsuario = (userId: string, chave: string) => `usuario:${userId}:${chave}`;

export async function carregarFiscal<T>(
  chave: string,
  _chaveLegada: string,
  vazio: T,
  _mesclarLegado?: (remoto: T, local: T) => T,
): Promise<T> {
  const userId = await usuarioFiscal();
  if (!userId) return lerSessao(chave, vazio);

  const chaveIsolada = chaveUsuario(userId, chave);
  await gravacoes.get(chaveIsolada);
  const salvo = typeof indexedDB === "undefined" ? undefined : await lerBanco(chaveIsolada);
  const versaoLocal =
    typeof indexedDB === "undefined" ? 0 : Number(await lerBanco(`versao:${chaveIsolada}`)) || 0;
  const temLocal = salvo !== undefined;
  const local = (temLocal ? salvo : vazio) as T;
  versoes.set(chaveIsolada, versaoLocal);

  try {
    const remoto = await carregarDaNuvem(chave);
    if (remoto && (!temLocal || remoto.versao >= versaoLocal)) {
      if (typeof indexedDB !== "undefined")
        await gravarBanco(chaveIsolada, remoto.dados, remoto.versao);
      versoes.set(chaveIsolada, remoto.versao);
      avisosNuvem.delete(chaveIsolada);
      sincronizacaoBloqueada.delete(chaveIsolada);
      return remoto.dados as T;
    }
    if (temLocal) {
      await salvarNaNuvem(chave, local, versaoLocal || Date.now());
      avisosNuvem.delete(chaveIsolada);
      sincronizacaoBloqueada.delete(chaveIsolada);
      return local;
    }
    avisosNuvem.delete(chaveIsolada);
    sincronizacaoBloqueada.delete(chaveIsolada);
    return vazio;
  } catch (error) {
    avisosNuvem.set(
      chaveIsolada,
      `Não foi possível sincronizar ${chave} na nuvem: ${mensagemErro(error)}`,
    );
    sincronizacaoBloqueada.add(chaveIsolada);
    if (!temLocal) throw error;
    return local;
  }
}

export function salvarFiscal(chave: string, _chaveLegada: string, dados: unknown): Promise<void> {
  return (async () => {
    const userId = await usuarioFiscal();
    if (!userId) {
      gravarSessao(chave, dados);
      return;
    }

    const chaveIsolada = chaveUsuario(userId, chave);
    const anterior = gravacoes.get(chaveIsolada) || Promise.resolve();
    const atual = anterior
      .catch(() => {})
      .then(async () => {
        const versao = Math.max(Date.now(), (versoes.get(chaveIsolada) || 0) + 1);
        if (typeof indexedDB !== "undefined") await gravarBanco(chaveIsolada, dados, versao);
        versoes.set(chaveIsolada, versao);
        try {
          if (sincronizacaoBloqueada.has(chaveIsolada)) {
            throw new Error(
              "A versão na nuvem não foi verificada. Recarregue a página quando a conexão voltar.",
            );
          }
          await salvarNaNuvem(chave, dados, versao);
          avisosNuvem.delete(chaveIsolada);
        } catch (error) {
          avisosNuvem.set(
            chaveIsolada,
            `Dados de ${chave} salvos neste navegador, mas não na nuvem: ${mensagemErro(error)}`,
          );
          throw error;
        }
      });
    gravacoes.set(chaveIsolada, atual);
    return atual.finally(() => {
      if (gravacoes.get(chaveIsolada) === atual) gravacoes.delete(chaveIsolada);
    });
  })();
}
