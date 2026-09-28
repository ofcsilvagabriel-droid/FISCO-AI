// Cache tributário com invalidação dirigida por dimensão
// (NCM, segmento, empresa, competência, legislação, produto,
// classificação). Construído sobre o memoryCache do core.
import { memoryCache } from "./memoryCache";
import { Versioning } from "@/core/versioning";

export type DimensaoCache =
  | "ncm" | "segmento" | "empresa" | "competencia"
  | "legislacao" | "produto" | "classificacao";

export interface ChaveCache extends Partial<Record<DimensaoCache, string>> {}

const NS = "tributario";
const TTL_PADRAO = 10 * 60 * 1000;

/** Índice reverso dimensão→chaves, para invalidação seletiva. */
const indice = new Map<string, Set<string>>();

function serializar(chave: ChaveCache): string {
  const partes = (Object.keys(chave) as DimensaoCache[])
    .sort()
    .filter((d) => chave[d])
    .map((d) => `${d}=${chave[d]}`);
  return `${Versioning.hash()}::${partes.join("&")}`;
}

function indexar(chave: ChaveCache, serial: string) {
  for (const [dim, valor] of Object.entries(chave)) {
    if (!valor) continue;
    const k = `${dim}:${valor}`;
    if (!indice.has(k)) indice.set(k, new Set());
    indice.get(k)!.add(serial);
  }
}

export const TaxCache = {
  get<T>(chave: ChaveCache): T | undefined {
    return memoryCache.get<T>(NS, serializar(chave));
  },
  set<T>(chave: ChaveCache, valor: T, ttlMs = TTL_PADRAO): T {
    const serial = serializar(chave);
    memoryCache.set(NS, serial, valor, ttlMs);
    indexar(chave, serial);
    return valor;
  },
  /** Lê do cache ou computa e memoriza. */
  wrap<T>(chave: ChaveCache, calcular: () => T, ttlMs = TTL_PADRAO): T {
    const hit = TaxCache.get<T>(chave);
    if (hit !== undefined) return hit;
    return TaxCache.set(chave, calcular(), ttlMs);
  },
  /** Invalida tudo que envolva uma dimensão específica. */
  invalidar(dimensao: DimensaoCache, valor: string): number {
    const k = `${dimensao}:${valor}`;
    const chaves = indice.get(k);
    if (!chaves) return 0;
    chaves.forEach((serial) => memoryCache.delete(NS, serial));
    indice.delete(k);
    return chaves.size;
  },
  invalidarTudo(): void {
    memoryCache.clear(NS);
    indice.clear();
  },
};
