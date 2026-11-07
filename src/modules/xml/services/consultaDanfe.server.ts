import type { ProvedorNfe, ResultadoConsultaNfe } from "@/modules/xml/providers/types";

const CONSULTA_DANFE_URL = "https://consultadanfe.com/api/v1/consulta";
const LIMITE_XML = 10 * 1024 * 1024;
const TIMEOUT_MS = 7_000;

export function normalizarXmlConsultaDanfe(xml: string) {
  const versao =
    xml.match(/<nfeProc\b[^>]*\bversao=["']([^"']+)["']/i)?.[1] ||
    xml.match(/<versao>([^<]+)<\/versao>/i)?.[1];
  let normalizado = xml.replace(
    /(<\?xml\b[^>]*\bencoding\s*=\s*["'])utf-8(["'][^>]*\?>)/i,
    "$1UTF-8$2",
  );
  if (versao) {
    normalizado = normalizado.replace(/<infNFe\b[^>]*>/i, (tag) =>
      /\bversao\s*=/i.test(tag) ? tag : tag.replace(/>$/, ` versao="${versao}">`),
    );
  }
  normalizado = normalizado.replace(
    />([^<]*)</g,
    (_, texto: string) => `>${texto.replace(/"/g, "&quot;")}<`,
  );
  return normalizado.replace(/(<\?xml\b[^>]*\?>)\s+(<nfeProc\b)/i, "$1$2");
}

export class ErroConsultaDanfe extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
    public readonly repetivel: boolean,
  ) {
    super(message);
    this.name = "ErroConsultaDanfe";
  }
}

const mensagemResposta = (valor: unknown) => {
  if (!valor || typeof valor !== "object") return "O provedor não devolveu o XML da NF-e.";
  const resposta = valor as Record<string, unknown>;
  return String(
    resposta.message || resposta.erro || resposta.error || "O provedor não devolveu o XML da NF-e.",
  ).slice(0, 500);
};

async function consultarXml(chave: string, fetcher: typeof fetch, signalExterno?: AbortSignal) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  const abortarExternamente = () => controlador.abort(signalExterno?.reason);
  if (signalExterno?.aborted) abortarExternamente();
  else signalExterno?.addEventListener("abort", abortarExternamente, { once: true });
  let resposta: Response;
  try {
    resposta = await fetcher(CONSULTA_DANFE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ chave }),
      signal: controlador.signal,
    });
  } catch (erro) {
    const timeoutAtingido = erro instanceof Error && erro.name === "AbortError";
    throw new ErroConsultaDanfe(
      timeoutAtingido
        ? "O provedor excedeu o tempo limite."
        : "Não foi possível acessar o provedor de XML.",
      timeoutAtingido ? "TIMEOUT" : "FALHA_REDE",
      true,
    );
  } finally {
    clearTimeout(timeout);
    signalExterno?.removeEventListener("abort", abortarExternamente);
  }

  let conteudo: unknown = null;
  try {
    conteudo = await resposta.json();
  } catch {
    conteudo = null;
  }
  if (!resposta.ok) {
    throw new ErroConsultaDanfe(
      mensagemResposta(conteudo),
      `HTTP_${resposta.status}`,
      resposta.status === 408 ||
        resposta.status === 425 ||
        resposta.status === 429 ||
        resposta.status >= 500,
    );
  }
  const xmlBase64 =
    conteudo && typeof conteudo === "object"
      ? (conteudo as Record<string, unknown>).xml_base64
      : null;
  if (typeof xmlBase64 !== "string" || !xmlBase64.trim()) {
    throw new ErroConsultaDanfe(mensagemResposta(conteudo), "XML_NAO_DISPONIVEL", false);
  }
  const xml = Buffer.from(xmlBase64, "base64");
  if (!xml.length || xml.length > LIMITE_XML || !xml.toString("utf8", 0, 200).includes("<")) {
    throw new ErroConsultaDanfe("O provedor devolveu um XML inválido.", "XML_INVALIDO", false);
  }
  return xml.toString("utf8");
}

/**
 * API pública legada. Permanece inalterada enquanto o worker ainda não usa
 * o contrato comum de provedores.
 */
export async function consultarXmlConsultaDanfe(chave: string, fetcher: typeof fetch = fetch) {
  return consultarXml(chave, fetcher);
}

export class ProvedorConsultaDanfe implements ProvedorNfe {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async consultarXml(chave: string, signal?: AbortSignal): Promise<ResultadoConsultaNfe> {
    const inicio = performance.now();
    const xml = await consultarXml(chave, this.fetcher, signal);
    return {
      chave,
      xml: Buffer.from(xml, "utf8"),
      situacao: "DESCONHECIDA",
      provedor: "CONSULTA_DANFE",
      oficial: false,
      duracaoMs: Math.max(0, performance.now() - inicio),
    };
  }
}

export const provedorConsultaDanfe: ProvedorNfe = new ProvedorConsultaDanfe();
