import { carregarFiscal, salvarFiscal } from "./PersistenciaFiscalLocal";

const HISTORICO_KEY = "fiscoai:historico-importacao:v1";

type EntradaHistorico = {
  id?: unknown;
  nota?: Record<string, unknown>;
  xml?: unknown;
};

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
};
