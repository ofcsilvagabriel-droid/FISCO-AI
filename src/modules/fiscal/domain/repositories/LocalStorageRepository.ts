// Base para repositórios persistidos em localStorage. Cada instância
// isola sua chave e valida os itens com o zod schema fornecido.
import type { ZodType } from "zod";
import { StorageError } from "@/core/errors";
import { logger } from "@/core/logger";

export interface Identifiable { id: string }

export class LocalStorageRepository<T extends Identifiable> {
  constructor(private readonly key: string, private readonly schema: ZodType<T, any, any>) {}

  private read(): T[] {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(this.key) : null;
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      const out: T[] = [];
      for (const item of arr) {
        const p = this.schema.safeParse(item);
        if (p.success) out.push(p.data);
        else logger.warn("repo", `item inválido ignorado em ${this.key}`, p.error.flatten());
      }
      return out;
    } catch (err) {
      throw new StorageError(`Falha ao ler ${this.key}`, err);
    }
  }

  private write(items: T[]): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(this.key, JSON.stringify(items));
    } catch (err) {
      throw new StorageError(`Falha ao gravar ${this.key}`, err);
    }
  }

  getAll(): T[] { return this.read(); }
  findById(id: string): T | undefined { return this.read().find((i) => i.id === id); }
  query(pred: (t: T) => boolean): T[] { return this.read().filter(pred); }

  upsert(item: T): T {
    const parsed = this.schema.parse(item);
    const all = this.read();
    const idx = all.findIndex((i) => i.id === parsed.id);
    if (idx >= 0) all[idx] = parsed; else all.push(parsed);
    this.write(all);
    return parsed;
  }

  remove(id: string): void {
    this.write(this.read().filter((i) => i.id !== id));
  }

  clear(): void { this.write([]); }
}
