import { chaveNfeValida } from "@/modules/xml/domain/chaveNfe";
import type { EventoNfe, ProvedorNfe, ResultadoConsultaNfe } from "@/modules/xml/providers/types";

const BASE_URL_PADRAO = "https://nfe.api.nfe.io";
const LIMITE_XML = 10 * 1024 * 1024;
const LIMITE_DANFE = 25 * 1024 * 1024;

export type ConfiguracaoNfeIo = {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  clientTimeoutSeconds: number;
  maxConcurrency: number;
};

const inteiro = (valor: string | undefined, padrao: number, minimo: number, maximo: number) => {
  const numero = Number.parseInt(String(valor || ""), 10);
  return Number.isFinite(numero) ? Math.max(minimo, Math.min(maximo, numero)) : padrao;
};

export function carregarConfiguracaoNfeIo(
  env: Record<string, string | undefined> = process.env,
): ConfiguracaoNfeIo {
  const baseUrl = String(env.NFE_IO_BASE_URL || BASE_URL_PADRAO).replace(/\/+$/, "");
  if (!/^https:\/\//i.test(baseUrl)) throw new Error("NFE_IO_BASE_URL deve usar HTTPS.");
  return {
    enabled: String(env.NFE_IO_ENABLED || "false").toLowerCase() === "true",
    apiKey: String(env.NFE_IO_API_KEY || "").trim(),
    baseUrl,
    timeoutMs: inteiro(env.NFE_IO_TIMEOUT_MS, 20_000, 1_000, 180_000),
    clientTimeoutSeconds: inteiro(env.NFE_IO_CLIENT_TIMEOUT_SECONDS, 20, 1, 180),
    maxConcurrency: inteiro(env.NFE_IO_MAX_CONCURRENCY, 2, 1, 20),
  };
}

export class ErroNfeIo extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
    public readonly repetivel: boolean,
    public readonly httpStatus?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ErroNfeIo";
  }
}

class LimitadorConcorrencia {
  private ativos = 0;
  private readonly espera: Array<() => void> = [];

  constructor(private readonly limite: number) {}

  async executar<T>(operacao: () => Promise<T>): Promise<T> {
    if (this.ativos >= this.limite) await new Promise<void>((resolve) => this.espera.push(resolve));
    this.ativos += 1;
    try {
      return await operacao();
    } finally {
      this.ativos -= 1;
      this.espera.shift()?.();
    }
  }
}

const repetivelPorStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const retryAfter = (resposta: Response) => {
  const valor = resposta.headers.get("retry-after");
  if (!valor) return undefined;
  const segundos = Number(valor);
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000);
  const data = Date.parse(valor);
  return Number.isFinite(data) ? Math.max(0, data - Date.now()) : undefined;
};

const mensagemResposta = async (resposta: Response, apiKey: string) => {
  let texto = "";
  try {
    texto = (await resposta.text()).slice(0, 500);
    const json = JSON.parse(texto) as Record<string, unknown>;
    texto = String(json.message || json.error || json.errors || texto);
  } catch {
    // A resposta pode ser texto ou XML de erro.
  }
  const limpa = apiKey ? texto.replaceAll(apiKey, "[REDACTED]") : texto;
  return limpa || `A NFE.io respondeu HTTP ${resposta.status}.`;
};

const validarChave = (chave: string) => {
  if (!chaveNfeValida(chave)) {
    throw new ErroNfeIo("A chave de acesso da NF-e é inválida.", "CHAVE_INVALIDA", false);
  }
};

const validarXml = (xml: Buffer, chave: string) => {
  const inicio = xml.toString("utf8", 0, Math.min(xml.length, 1024 * 1024));
  const chaveNoXml = inicio.match(/<infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i)?.[1];
  if (
    !xml.length ||
    xml.length > LIMITE_XML ||
    !/<nfeProc\b/i.test(inicio) ||
    !/<NFe\b/i.test(inicio) ||
    chaveNoXml !== chave
  ) {
    throw new ErroNfeIo(
      "A NFE.io devolveu um XML que não corresponde à NF-e solicitada.",
      "XML_INVALIDO",
      false,
    );
  }
};

const normalizarEventos = (valor: unknown): EventoNfe[] => {
  const raiz = valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  const lista = Array.isArray(valor) ? valor : Array.isArray(raiz.events) ? raiz.events : [];
  return lista
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      tipo: String(item.type || item.tipo || item.eventType || "DESCONHECIDO"),
      sequencia: Number(item.sequence ?? item.sequencia) || null,
      protocolo: String(item.protocol || item.protocolo || item.nProt || "") || null,
      dataEvento:
        String(item.eventDate || item.dataEvento || item.dateTime || item.date || "") || null,
      codigoStatus:
        String(item.statusCode || item.codigoStatus || item.cStat || item.status || "") || null,
      descricao: String(item.description || item.descricao || item.xMotivo || "") || null,
    }));
};

export class ProvedorNfeIo implements ProvedorNfe {
  private readonly limitador: LimitadorConcorrencia;

  constructor(
    private readonly configuracao = carregarConfiguracaoNfeIo(),
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.limitador = new LimitadorConcorrencia(configuracao.maxConcurrency);
  }

  private async requisitar(path: string, accept: string, signalExterno?: AbortSignal) {
    if (!this.configuracao.enabled) {
      throw new ErroNfeIo("A integração NFE.io está desativada.", "PROVEDOR_DESATIVADO", false);
    }
    if (!this.configuracao.apiKey) {
      throw new ErroNfeIo(
        "A chave de servidor da NFE.io não foi configurada.",
        "CREDENCIAL_AUSENTE",
        false,
      );
    }
    return this.limitador.executar(async () => {
      const controlador = new AbortController();
      let timeoutAtingido = false;
      const timeout = setTimeout(() => {
        timeoutAtingido = true;
        controlador.abort();
      }, this.configuracao.timeoutMs);
      const abortarExternamente = () => controlador.abort(signalExterno?.reason);
      if (signalExterno?.aborted) abortarExternamente();
      else signalExterno?.addEventListener("abort", abortarExternamente, { once: true });
      try {
        const resposta = await this.fetcher(`${this.configuracao.baseUrl}${path}`, {
          method: "GET",
          headers: {
            Accept: accept,
            Authorization: this.configuracao.apiKey,
            "X-Client-Timeout-Seconds": String(this.configuracao.clientTimeoutSeconds),
          },
          signal: controlador.signal,
        });
        if (!resposta.ok) {
          throw new ErroNfeIo(
            await mensagemResposta(resposta, this.configuracao.apiKey),
            `HTTP_${resposta.status}`,
            repetivelPorStatus(resposta.status),
            resposta.status,
            retryAfter(resposta),
          );
        }
        return resposta;
      } catch (erro) {
        if (erro instanceof ErroNfeIo) throw erro;
        const cancelada = erro instanceof Error && erro.name === "AbortError";
        throw new ErroNfeIo(
          timeoutAtingido
            ? "A NFE.io excedeu o tempo limite configurado."
            : cancelada
              ? "A consulta NFE.io foi cancelada."
              : "Não foi possível acessar a NFE.io.",
          timeoutAtingido ? "TIMEOUT" : cancelada ? "CANCELADA" : "FALHA_REDE",
          true,
        );
      } finally {
        clearTimeout(timeout);
        signalExterno?.removeEventListener("abort", abortarExternamente);
      }
    });
  }

  async consultarXml(chave: string, signal?: AbortSignal): Promise<ResultadoConsultaNfe> {
    validarChave(chave);
    const inicio = performance.now();
    const resposta = await this.requisitar(
      `/v3/productinvoices/serpro/${encodeURIComponent(chave)}.xml`,
      "application/xml",
      signal,
    );
    const xml = Buffer.from(await resposta.arrayBuffer());
    validarXml(xml, chave);
    return {
      chave,
      xml,
      situacao: "DESCONHECIDA",
      provedor: "NFE_IO",
      oficial: true,
      duracaoMs: Math.max(0, performance.now() - inicio),
    };
  }

  async consultarDanfe(chave: string, signal?: AbortSignal): Promise<ResultadoConsultaNfe> {
    validarChave(chave);
    const inicio = performance.now();
    const resposta = await this.requisitar(
      `/v2/productinvoices/serpro/${encodeURIComponent(chave)}.pdf`,
      "application/pdf",
      signal,
    );
    const danfe = Buffer.from(await resposta.arrayBuffer());
    if (!danfe.length || danfe.length > LIMITE_DANFE || danfe.toString("ascii", 0, 5) !== "%PDF-") {
      throw new ErroNfeIo("A NFE.io devolveu um DANFE inválido.", "DANFE_INVALIDO", false);
    }
    return {
      chave,
      danfe,
      situacao: "DESCONHECIDA",
      provedor: "NFE_IO",
      oficial: true,
      duracaoMs: Math.max(0, performance.now() - inicio),
    };
  }

  async consultarEventos(chave: string, signal?: AbortSignal): Promise<EventoNfe[]> {
    validarChave(chave);
    const resposta = await this.requisitar(
      `/v2/productinvoices/events/${encodeURIComponent(chave)}`,
      "application/json",
      signal,
    );
    let conteudo: unknown;
    try {
      conteudo = await resposta.json();
    } catch {
      throw new ErroNfeIo("A NFE.io devolveu eventos inválidos.", "EVENTOS_INVALIDOS", false);
    }
    return normalizarEventos(conteudo);
  }
}

export const provedorNfeIo: ProvedorNfe = new ProvedorNfeIo();
