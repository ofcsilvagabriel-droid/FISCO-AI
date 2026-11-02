const CONSULTA_DANFE_URL = "https://consultadanfe.com/api/v1/consulta";
const LIMITE_XML = 10 * 1024 * 1024;
const TIMEOUT_MS = 7_000;

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

export async function consultarXmlConsultaDanfe(chave: string, fetcher: typeof fetch = fetch) {
  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);
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
