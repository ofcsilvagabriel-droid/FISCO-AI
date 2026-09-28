// Conector HTTP para sistemas externos (Gestão de Processos, contábil,
// financeiro, CRM…). Comunicação exclusivamente por API: JWT, timeout,
// retry, versionamento e logs. Nunca compartilha banco de dados.
import { httpRequest } from "@/core/api";
import { logger } from "@/core/logger";
import type { DomainEvent, ExternalConnector, TipoEvento } from "../types";

export interface HttpConnectorConfig {
  nome: string;
  baseUrl: string;
  versaoApi?: string;
  /** Provedor de token JWT (assíncrono, permite refresh). */
  token?: () => string | null | Promise<string | null>;
  /** Tipos aceitos; omitido = todos. */
  tipos?: TipoEvento[];
  caminho?: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export function criarHttpConnector(cfg: HttpConnectorConfig): ExternalConnector {
  const versaoApi = cfg.versaoApi ?? "v1";
  return {
    nome: cfg.nome,
    versaoApi,
    aceita: (evento) => !cfg.tipos || cfg.tipos.includes(evento.tipo),
    async enviar(evento: DomainEvent) {
      const token = (await cfg.token?.()) ?? null;
      const headers: Record<string, string> = {
        "X-Event-Id": evento.id,
        "X-Event-Type": evento.tipo,
        "X-Api-Version": versaoApi,
        ...(cfg.headers ?? {}),
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const url = `${cfg.baseUrl.replace(/\/$/, "")}/${versaoApi}${cfg.caminho ?? "/events"}`;
      await httpRequest({
        url,
        method: "POST",
        headers,
        body: evento,
        timeoutMs: cfg.timeoutMs ?? 10000,
        retries: cfg.retries ?? 2,
      });
      logger.info("integration", `evento ${evento.tipo} entregue em ${cfg.nome}`);
    },
  };
}
