// Cache in-memory por namespace, com TTL opcional.
// Não persiste — usar Repository para persistência.

interface Entry<T> { value: T; expiresAt: number | null }

const store = new Map<string, Entry<unknown>>();

function k(ns: string, key: string) { return `${ns}::${key}`; }

export const memoryCache = {
  get<T>(ns: string, key: string): T | undefined {
    const e = store.get(k(ns, key)) as Entry<T> | undefined;
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt < Date.now()) {
      store.delete(k(ns, key));
      return undefined;
    }
    return e.value;
  },
  set<T>(ns: string, key: string, value: T, ttlMs?: number) {
    store.set(k(ns, key), { value, expiresAt: ttlMs ? Date.now() + ttlMs : null });
  },
  delete(ns: string, key: string) { store.delete(k(ns, key)); },
  clear(ns?: string) {
    if (!ns) { store.clear(); return; }
    for (const key of store.keys()) if (key.startsWith(`${ns}::`)) store.delete(key);
  },
};
