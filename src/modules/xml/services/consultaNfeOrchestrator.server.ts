/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";

import { descriptografarXml } from "@/modules/dfe/services/certificadoDfe.server";
import { provedorNfeIo } from "@/modules/xml/providers/nfeIo.server";
import type {
  ProvedorNfe,
  ProvedorNfeId,
  ResultadoConsultaNfe,
} from "@/modules/xml/providers/types";
import { provedorConsultaDanfe } from "@/modules/xml/services/consultaDanfe.server";

export type PoliticaConsultaNfe = "ECONOMIA" | "RAPIDO" | "OFICIAL";

export type ResultadoConsultaNfeOrquestrada = ResultadoConsultaNfe & {
  cacheHit: boolean;
  provedoresConsultados: ProvedorNfeId[];
};

type DependenciasOrquestrador = {
  consultaDanfe?: ProvedorNfe;
  nfeIo?: ProvedorNfe;
  atrasoHedgeMs?: number;
  consultarCache?: (db: any, userId: string, chave: string) => Promise<Buffer | null>;
};

type ErroClassificado = {
  codigo: string;
  repetivel: boolean;
  httpStatus?: number;
  retryAfterMs?: number;
};

export class ErroConsultaNfeOrquestrada extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
    public readonly repetivel: boolean,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ErroConsultaNfeOrquestrada";
  }
}

const politicaConfigurada = (valor = process.env.NFE_PROVIDER_POLICY): PoliticaConsultaNfe => {
  const politica = String(valor || "ECONOMIA").toUpperCase();
  return politica === "RAPIDO" || politica === "OFICIAL" ? politica : "ECONOMIA";
};

export const orquestradorNfeAtivo = () =>
  String(process.env.NFE_ORCHESTRATOR_ENABLED || "false").toLowerCase() === "true";

const classificarErro = (erro: unknown): ErroClassificado => {
  const valor = erro as Partial<ErroClassificado> | undefined;
  return {
    codigo: String(valor?.codigo || "FALHA_PROVEDOR"),
    repetivel: valor?.repetivel !== false,
    httpStatus: typeof valor?.httpStatus === "number" ? valor.httpStatus : undefined,
    retryAfterMs: typeof valor?.retryAfterMs === "number" ? valor.retryAfterMs : undefined,
  };
};

const validarResultado = (resultado: ResultadoConsultaNfe, chave: string) => {
  if (!resultado.xml?.length) throw new Error("O provedor não devolveu o XML da NF-e.");
  const inicio = resultado.xml.toString("utf8", 0, Math.min(resultado.xml.length, 1024 * 1024));
  const chaveXml = inicio.match(/<infNFe\b[^>]*\bId=["']NFe(\d{44})["']/i)?.[1];
  if (chaveXml !== chave || !/<NFe\b/i.test(inicio)) {
    throw new Error("O XML devolvido não corresponde à chave consultada.");
  }
  return resultado;
};

async function consultarCache(db: any, userId: string, chave: string) {
  const { data: documento, error } = await db
    .from("fiscoai_dfe_documentos")
    .select("storage_path,sha256")
    .eq("user_id", userId)
    .eq("chave_acesso", chave)
    .eq("tipo_conteudo", "XML_COMPLETO")
    .maybeSingle();
  if (error || !documento?.storage_path || !documento.sha256) return null;
  const { data: arquivo, error: arquivoErro } = await db.storage
    .from("fiscoai-dfe-xml")
    .download(documento.storage_path);
  if (arquivoErro || !arquivo) return null;
  try {
    const xml = descriptografarXml(Buffer.from(await arquivo.arrayBuffer()));
    if (createHash("sha256").update(xml).digest("hex") !== documento.sha256) return null;
    validarResultado(
      {
        chave,
        xml,
        provedor: "CONSULTA_DANFE",
        oficial: false,
        duracaoMs: 0,
      },
      chave,
    );
    return xml;
  } catch {
    return null;
  }
}

async function auditarTentativa(
  db: any,
  entrada: {
    userId: string;
    itemId?: string;
    chave: string;
    provedor: ProvedorNfeId;
    inicio: string;
    duracaoMs: number;
    resultado?: ResultadoConsultaNfe;
    erro?: unknown;
  },
) {
  const classificado = classificarErro(entrada.erro);
  await db
    .from("fiscoai_dfe_consultas")
    .insert({
      user_id: entrada.userId,
      item_id: entrada.itemId || null,
      chave_acesso: entrada.chave,
      provedor: entrada.provedor,
      iniciado_em: entrada.inicio,
      duracao_ms: Math.round(entrada.duracaoMs),
      http_status: classificado.httpStatus || null,
      codigo_retorno: entrada.erro ? classificado.codigo : "XML_VALIDADO",
      sucesso: Boolean(entrada.resultado?.xml),
      hash_retorno: entrada.resultado?.xml
        ? createHash("sha256").update(entrada.resultado.xml).digest("hex")
        : null,
      finalizado_em: new Date().toISOString(),
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

async function executarTentativa(
  db: any,
  entrada: {
    userId: string;
    itemId?: string;
    chave: string;
    provedor: ProvedorNfe;
    provedorId: ProvedorNfeId;
    signal?: AbortSignal;
  },
) {
  const inicioIso = new Date().toISOString();
  const inicio = performance.now();
  try {
    const resultado = validarResultado(
      await entrada.provedor.consultarXml(entrada.chave, entrada.signal),
      entrada.chave,
    );
    await auditarTentativa(db, {
      userId: entrada.userId,
      itemId: entrada.itemId,
      chave: entrada.chave,
      provedor: entrada.provedorId,
      inicio: inicioIso,
      duracaoMs: performance.now() - inicio,
      resultado,
    });
    return resultado;
  } catch (erro) {
    await auditarTentativa(db, {
      userId: entrada.userId,
      itemId: entrada.itemId,
      chave: entrada.chave,
      provedor: entrada.provedorId,
      inicio: inicioIso,
      duracaoMs: performance.now() - inicio,
      erro,
    });
    throw erro;
  }
}

const aguardar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function consultarXmlNfeOrquestrado(
  db: any,
  entrada: {
    userId: string;
    itemId?: string;
    chave: string;
    politica?: PoliticaConsultaNfe;
  },
  dependencias: DependenciasOrquestrador = {},
): Promise<ResultadoConsultaNfeOrquestrada> {
  const xmlCache = await (dependencias.consultarCache || consultarCache)(
    db,
    entrada.userId,
    entrada.chave,
  );
  if (xmlCache) {
    return {
      chave: entrada.chave,
      xml: xmlCache,
      provedor: "CONSULTA_DANFE",
      oficial: false,
      duracaoMs: 0,
      cacheHit: true,
      provedoresConsultados: [],
    };
  }

  const consultaDanfe = dependencias.consultaDanfe || provedorConsultaDanfe;
  const nfeIo = dependencias.nfeIo || provedorNfeIo;
  const politica = entrada.politica || politicaConfigurada();
  const ordem =
    politica === "OFICIAL"
      ? ([
          { id: "NFE_IO", provedor: nfeIo },
          { id: "CONSULTA_DANFE", provedor: consultaDanfe },
        ] as const)
      : ([
          { id: "CONSULTA_DANFE", provedor: consultaDanfe },
          { id: "NFE_IO", provedor: nfeIo },
        ] as const);
  const consultados: ProvedorNfeId[] = [];
  const executar = (indice: 0 | 1, signal?: AbortSignal) => {
    consultados.push(ordem[indice].id);
    return executarTentativa(db, {
      ...entrada,
      provedor: ordem[indice].provedor,
      provedorId: ordem[indice].id,
      signal,
    });
  };

  if (politica !== "RAPIDO") {
    let primeiroErro: unknown;
    try {
      const resultado = await executar(0);
      return { ...resultado, cacheHit: false, provedoresConsultados: [...consultados] };
    } catch (erro) {
      primeiroErro = erro;
    }
    try {
      const resultado = await executar(1);
      return { ...resultado, cacheHit: false, provedoresConsultados: [...consultados] };
    } catch (segundoErro) {
      const erros = [primeiroErro, segundoErro].map(classificarErro);
      throw new ErroConsultaNfeOrquestrada(
        segundoErro instanceof Error ? segundoErro.message : "Nenhum provedor devolveu o XML.",
        erros[1].codigo || erros[0].codigo,
        erros.some((erro) => erro.repetivel),
        Math.max(...erros.map((erro) => erro.retryAfterMs || 0)) || undefined,
      );
    }
  }

  const controladores = [new AbortController(), new AbortController()];
  const primeira = executar(0, controladores[0].signal);
  const antesDoHedge = await Promise.race([
    primeira.then(
      (resultado) => ({ tipo: "resultado" as const, resultado }),
      (erro) => ({ tipo: "erro" as const, erro }),
    ),
    aguardar(dependencias.atrasoHedgeMs ?? 1_500).then(() => ({ tipo: "atraso" as const })),
  ]);
  if (antesDoHedge.tipo === "resultado") {
    return {
      ...antesDoHedge.resultado,
      cacheHit: false,
      provedoresConsultados: [...consultados],
    };
  }
  if (antesDoHedge.tipo === "erro") {
    try {
      const resultado = await executar(1);
      return { ...resultado, cacheHit: false, provedoresConsultados: [...consultados] };
    } catch (segundoErro) {
      const erros = [antesDoHedge.erro, segundoErro].map(classificarErro);
      throw new ErroConsultaNfeOrquestrada(
        segundoErro instanceof Error ? segundoErro.message : "Nenhum provedor devolveu o XML.",
        erros[1].codigo || erros[0].codigo,
        erros.some((erro) => erro.repetivel),
        Math.max(...erros.map((erro) => erro.retryAfterMs || 0)) || undefined,
      );
    }
  }

  const segunda = executar(1, controladores[1].signal);
  const acomodar = (promessa: Promise<ResultadoConsultaNfe>, indice: 0 | 1) =>
    promessa.then(
      (resultado) => ({ sucesso: true as const, resultado, indice }),
      (erro) => ({ sucesso: false as const, erro, indice }),
    );
  const primeiraConclusao = await Promise.race([acomodar(primeira, 0), acomodar(segunda, 1)]);
  if (primeiraConclusao.sucesso) {
    controladores[primeiraConclusao.indice === 0 ? 1 : 0].abort();
    return {
      ...primeiraConclusao.resultado,
      cacheHit: false,
      provedoresConsultados: [...consultados],
    };
  }
  const outraConclusao = await acomodar(
    primeiraConclusao.indice === 0 ? segunda : primeira,
    primeiraConclusao.indice === 0 ? 1 : 0,
  );
  if (outraConclusao.sucesso) {
    return {
      ...outraConclusao.resultado,
      cacheHit: false,
      provedoresConsultados: [...consultados],
    };
  }
  const erros = [primeiraConclusao.erro, outraConclusao.erro].map(classificarErro);
  throw new ErroConsultaNfeOrquestrada(
    outraConclusao.erro instanceof Error
      ? outraConclusao.erro.message
      : "Nenhum provedor devolveu o XML.",
    erros[1].codigo || erros[0].codigo,
    erros.some((erro) => erro.repetivel),
    Math.max(...erros.map((erro) => erro.retryAfterMs || 0)) || undefined,
  );
}
