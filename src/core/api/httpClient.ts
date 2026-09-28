// Wrapper fetch com timeout, retry leve e normalização de erros.
// Nenhuma tela deve chamar fetch direto — usar este cliente via
// Repository ou Integration Service.
import { HTTP_DEFAULTS } from "../constants/http";
import { IntegrationError } from "../errors/AppError";
import { logger } from "../logger/logger";

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  raw?: boolean; // se true, não parseia JSON e devolve Response
}

async function once(req: HttpRequest): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), req.timeoutMs ?? HTTP_DEFAULTS.timeoutMs);
  try {
    const isForm = typeof FormData !== "undefined" && req.body instanceof FormData;
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    let body: BodyInit | undefined;
    if (req.body === undefined || req.body === null) body = undefined;
    else if (isForm || typeof req.body === "string") body = req.body as BodyInit;
    else { body = JSON.stringify(req.body); headers["Content-Type"] ??= "application/json"; }
    return await fetch(req.url, { method: req.method ?? "GET", headers, body, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function httpRequest<T = unknown>(req: HttpRequest): Promise<T> {
  const retries = req.retries ?? HTTP_DEFAULTS.retries;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await once(req);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new IntegrationError(`HTTP ${res.status} em ${req.url}`, {
          status: res.status, context: { body: text.slice(0, 500) },
        });
      }
      if (req.raw) return res as unknown as T;
      const ctype = res.headers.get("content-type") ?? "";
      if (ctype.includes("application/json")) return (await res.json()) as T;
      return (await res.text()) as unknown as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        logger.warn("http", `tentativa ${attempt + 1} falhou, retry`, { url: req.url });
        await new Promise((r) => setTimeout(r, HTTP_DEFAULTS.retryDelayMs));
      }
    }
  }
  if (lastErr instanceof IntegrationError) throw lastErr;
  throw new IntegrationError(`Falha de rede em ${req.url}`, { cause: lastErr });
}

export const httpClient = {
  get: <T = unknown>(url: string, init?: Omit<HttpRequest, "url" | "method" | "body">) =>
    httpRequest<T>({ ...init, url, method: "GET" }),
  post: <T = unknown>(url: string, body?: unknown, init?: Omit<HttpRequest, "url" | "method" | "body">) =>
    httpRequest<T>({ ...init, url, method: "POST", body }),
  put: <T = unknown>(url: string, body?: unknown, init?: Omit<HttpRequest, "url" | "method" | "body">) =>
    httpRequest<T>({ ...init, url, method: "PUT", body }),
  delete: <T = unknown>(url: string, init?: Omit<HttpRequest, "url" | "method" | "body">) =>
    httpRequest<T>({ ...init, url, method: "DELETE" }),
};
