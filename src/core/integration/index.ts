// Barril público do Integration Core.
export { IntegrationCore } from "./IntegrationCore";
export { EventBus } from "./EventBus";
export { EventStore } from "./EventStore";
export { ModuleRegistry } from "./ModuleRegistry";
export { WebhookDispatcher } from "./transport/WebhookDispatcher";
export { criarHttpConnector } from "./transport/HttpConnector";
export type { HttpConnectorConfig } from "./transport/HttpConnector";
export { TIPOS_EVENTO, DomainEventSchema } from "./types";
export type {
  DomainEvent,
  EventoInput,
  EventoContexto,
  EventHandler,
  EventSubscription,
  ExternalConnector,
  ModuleContract,
  ModuloPlataforma,
  StatusEvento,
  TipoEvento,
} from "./types";
