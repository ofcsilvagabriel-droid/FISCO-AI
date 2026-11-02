import { carregarFiscal, salvarFiscal } from "./PersistenciaFiscalLocal";

const HISTORICO_KEY = "fiscoai:historico-importacao:v1";

type EntradaHistorico = {
  id?: unknown;
  nota?: Record<string, unknown>;
  xml?: unknown;
};

type IdentidadeDocumentoFiscal = {
  chave_acesso?: unknown;
  cnpj?: unknown;
  data_emissao?: unknown;
  uf_destino?: unknown;
};

const digitos = (valor: unknown) => String(valor ?? "").replace(/\D/g, "");

export function reconciliarHistoricoComDocumentos<T extends EntradaHistorico>(
  historico: T[],
  documentos: IdentidadeDocumentoFiscal[],
  nomesEmpresas: Record<string, string> = {},
): { dados: T[]; alterado: boolean } {
  const porChave = new Map(
    (documentos || [])
      .map(documento => [digitos(documento.chave_acesso), documento] as const)
      .filter(([chave, documento]) => chave.length === 44 && /^\d{14}$/.test(digitos(documento.cnpj))),
  );
  let alterado = false;
  const dados = (historico || []).map(entrada => {
    const chave = digitos(entrada?.nota?.chave ?? entrada?.nota?.chave_acesso);
    const documento = chave.length === 44 ? porChave.get(chave) : null;
    if (!documento) return entrada;
    const cnpj = digitos(documento.cnpj);
    const nome = nomesEmpresas[cnpj] || String(entrada.nota?.destinatario_nome || "");
    const dataEmissao = String(documento.data_emissao || entrada.nota?.data_emissao || "");
    const ufDestino = String(documento.uf_destino || entrada.nota?.uf_destino || "");
    if (
      digitos(entrada.nota?.destinatario_cnpj) === cnpj &&
      entrada.nota?.destinatario_nome === nome &&
      entrada.nota?.data_emissao === dataEmissao &&
      entrada.nota?.uf_destino === ufDestino
    ) return entrada;
    alterado = true;
    return {
      ...entrada,
      nota: {
        ...entrada.nota,
        destinatario_cnpj: cnpj,
        destinatario_nome: nome,
        data_emissao: dataEmissao,
        uf_destino: ufDestino,
      },
    } as T;
  });
  return { dados: alterado ? dados : historico, alterado };
}

export function identidadeImportacao(entrada: EntradaHistorico): string | null {
  const nota = entrada?.nota || {};
  const chave = String(nota.chave ?? nota.chave_acesso ?? "").replace(/\D/g, "");
  if (chave.length === 44) return `nfe:${chave}`;

  const emitente = String(nota.emitente_cnpj ?? "").replace(/\D/g, "");
  const numero = String(nota.numero ?? "").replace(/\D/g, "").replace(/^0+/, "") || "0";
  const serie = String(nota.serie ?? "").replace(/\D/g, "").replace(/^0+/, "") || "0";
  const emissao = String(nota.data_emissao ?? "").slice(0, 10);
  if (emitente && String(nota.numero ?? "").trim() && String(nota.serie ?? "").trim() && /^\d{4}-\d{2}-\d{2}$/.test(emissao)) {
    return `nota:${emitente}:${serie}:${numero}:${emissao}`;
  }
  const xml = typeof entrada?.xml === "string" ? entrada.xml.trim() : "";
  return xml ? `xml:${xml}` : null;
}

export function mesclarHistorico<T extends EntradaHistorico>(existentes: T[], novas: T[]): T[] {
  const idsExistentes = new Map<string, unknown>();
  existentes.forEach(entrada => {
    const identidade = identidadeImportacao(entrada);
    if (identidade && !idsExistentes.has(identidade)) idsExistentes.set(identidade, entrada.id);
  });
  const vistas = new Set<string>();
  return [...novas, ...existentes].flatMap((entrada, indice) => {
    const identidade = identidadeImportacao(entrada);
    if (identidade && vistas.has(identidade)) return [];
    if (identidade) vistas.add(identidade);
    return [indice < novas.length && identidade && idsExistentes.has(identidade)
      ? { ...entrada, id: idsExistentes.get(identidade) } as T
      : entrada];
  });
}

export const HistoricoImportacaoService = {
  async load(): Promise<EntradaHistorico[]> {
    const dados = await carregarFiscal<EntradaHistorico[]>("historico-importacao", HISTORICO_KEY, [], (remoto, local) => mesclarHistorico(local, remoto));
    if (!Array.isArray(dados)) throw new Error("Histórico de importações salvo é inválido.");
    const semDuplicatas = mesclarHistorico(dados, []);
    if (semDuplicatas.length !== dados.length) await salvarFiscal("historico-importacao", HISTORICO_KEY, semDuplicatas);
    return semDuplicatas;
  },
  save(dados: EntradaHistorico[]): Promise<void> {
    return salvarFiscal("historico-importacao", HISTORICO_KEY, mesclarHistorico(dados, []));
  },
  reconciliarComDocumentos: reconciliarHistoricoComDocumentos,
};
