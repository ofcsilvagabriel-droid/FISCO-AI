// Registro de módulos da plataforma. Um módulo declara nome, versão,
// assinaturas de eventos e capacidades — nunca importa outro módulo.
import { logger } from "@/core/logger";
import { EventBus } from "./EventBus";
import type { ModuleContract } from "./types";

const modulos = new Map<string, ModuleContract>();

export const ModuleRegistry = {
  registrar(modulo: ModuleContract): void {
    if (modulos.has(modulo.nome)) return; // idempotente
    modulos.set(modulo.nome, modulo);
    modulo.assinaturas?.forEach((s) => EventBus.subscribe(s));
    logger.info("integration", `módulo registrado: ${modulo.nome}@${modulo.versao}`);
  },
  obter(nome: string): ModuleContract | undefined { return modulos.get(nome); },
  listar(): ModuleContract[] { return [...modulos.values()]; },
  /** Invoca uma capacidade exposta por outro módulo (sem import direto). */
  invocar<T = unknown>(nomeModulo: string, capacidade: string, ...args: unknown[]): T {
    const mod = modulos.get(nomeModulo);
    const fn = mod?.capacidades?.[capacidade] as ((...a: unknown[]) => T) | undefined;
    if (!fn) throw new Error(`Capacidade ${nomeModulo}.${capacidade} não registrada`);
    return fn(...args);
  },
  limpar(): void { modulos.clear(); },
};
