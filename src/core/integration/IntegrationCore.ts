// Integration Core — fachada única de comunicação entre módulos.
// Nenhum módulo importa outro módulo: publica eventos, assina eventos
// ou invoca capacidades registradas por aqui.
import { EventBus } from "./EventBus";
import { EventStore } from "./EventStore";
import { ModuleRegistry } from "./ModuleRegistry";
import { WebhookDispatcher } from "./transport/WebhookDispatcher";
import { criarHttpConnector, type HttpConnectorConfig } from "./transport/HttpConnector";
import type { DomainEvent, EventoInput, EventSubscription, ModuleContract } from "./types";

export const IntegrationCore = {
  // --- módulos
  registrarModulo(modulo: ModuleContract) { ModuleRegistry.registrar(modulo); },
  modulos() { return ModuleRegistry.listar().map((m) => ({ nome: m.nome, versao: m.versao })); },
  invocar<T = unknown>(modulo: string, capacidade: string, ...args: unknown[]): T {
    return ModuleRegistry.invocar<T>(modulo, capacidade, ...args);
  },

  // --- eventos
  publicar(input: EventoInput): DomainEvent { return EventBus.publish(input); },
  publicarESperar(input: EventoInput): Promise<DomainEvent> { return EventBus.publishAndWait(input); },
  assinar(sub: EventSubscription): () => void { return EventBus.subscribe(sub); },
  eventos(filtro?: Parameters<typeof EventStore.listar>[0]) { return EventStore.listar(filtro); },
  eventosPorContexto(chave: keyof DomainEvent["contexto"], valor: string) {
    return EventStore.porContexto(chave, valor);
  },

  // --- integrações externas (API-only)
  conectarSistemaExterno(cfg: HttpConnectorConfig) {
    WebhookDispatcher.registrar(criarHttpConnector(cfg));
    WebhookDispatcher.ativar();
  },
  desconectarSistemaExterno(nome: string) { WebhookDispatcher.remover(nome); },
  integracoes() { return WebhookDispatcher.listar(); },
};

export type IntegrationCoreType = typeof IntegrationCore;
