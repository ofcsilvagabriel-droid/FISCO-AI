// Service: memória de decisões manuais de cálculo por NCM.
// Toda decisão manual do usuário (ST com MVA, Antecipação, DIFAL,
// Isento, Não Tributado, presunção de crédito) é memorizada por NCM
// e reaplicada automaticamente em novas notas com o mesmo NCM.
import { MemoriaCalculoRepository } from "../repositories/MemoriaCalculoRepository";
import {
  type MemoriaCalculoPorNCM,
  type TipoDecisaoMemoria,
} from "../entities/memoriaCalculo";

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const MODO_POR_TIPO: Record<string, string> = {
  ST_MANUAL: "ICMS_ST",
  ANTECIPACAO_MANUAL: "ANTECIPACAO",
  DIFAL_MANUAL: "DIFAL",
  ISENTO: "ISENTO",
  NAO_TRIBUTADO: "NAO_TRIBUTADO",
  PRESUNCAO_CREDITO: "AUTO",
};

export const TIPO_POR_MODO: Record<string, TipoDecisaoMemoria> = {
  ICMS_ST: "ST_MANUAL",
  ANTECIPACAO: "ANTECIPACAO_MANUAL",
  DIFAL: "DIFAL_MANUAL",
  ISENTO: "ISENTO",
  NAO_TRIBUTADO: "NAO_TRIBUTADO",
};

export const MemoriaCalculoService = {
  digitos,
  tipoPorModo: (modo: string) => TIPO_POR_MODO[modo] || null,
  modoPorTipo: (tipo: string) => MODO_POR_TIPO[tipo] || "AUTO",

  listar(): MemoriaCalculoPorNCM[] {
    return MemoriaCalculoRepository.getAll().sort((a, b) =>
      (b.atualizado_em || "").localeCompare(a.atualizado_em || ""),
    );
  },

  ativos(): MemoriaCalculoPorNCM[] {
    return MemoriaCalculoService.listar().filter((m) => m.ativo);
  },

  /**
   * Melhor memória ativa para o NCM (match exato > prefixo mais longo).
   * AJUSTE 3 — isolamento estrito: `empresaId` é obrigatório e nenhum
   * registro de outra empresa (nem com empresa_id nulo) é aplicado.
   */
  obterMemoriaPorNCM(ncm: unknown, empresaId?: string | null): MemoriaCalculoPorNCM | null {
    const emp = String(empresaId ?? "").trim();
    if (!emp) {
      console.warn("[MEMORIA_ISOLAMENTO_VIOLADO] obterMemoriaPorNCM chamado sem empresa_id — memória ignorada.");
      return null;
    }
    const nd = digitos(ncm);
    if (!nd) return null;
    let melhor: MemoriaCalculoPorNCM | null = null;
    for (const m of MemoriaCalculoService.ativos()) {
      const alvo = digitos(m.ncm);
      if (!alvo || !nd.startsWith(alvo)) continue;
      if (String(m.empresa_id ?? "") !== emp) continue;
      if (!melhor || alvo.length > digitos(melhor.ncm).length) melhor = m;
    }
    return melhor;
  },


  /** Converte a memória em uma decisão manual pré-preenchida. */
  aplicarMemoria(mem: MemoriaCalculoPorNCM | null) {
    if (!mem) return null;
    const p = mem.parametros || {};
    return {
      modo: MODO_POR_TIPO[mem.tipo_decisao] || "AUTO",
      mva_informada: p.mva_informada ?? p.mva_utilizada ?? null,
      mva_ja_ajustada: !!p.mva_ja_ajustada,
      forcar_st: true,
      origem_memoria: true,
      memoria_id: mem.id,
      memoria_ncm: mem.ncm,
      memoria_tipo: mem.tipo_decisao,
      criado_em: mem.criado_em,
      alterado_em: mem.atualizado_em,
    };
  },

  /** Cria ou atualiza (sobrescreve) a memória de um NCM + tipo. */
  gravarMemoria(params: {
    ncm: unknown;
    tipo_decisao: TipoDecisaoMemoria;
    parametros?: Record<string, unknown>;
    fundamento?: string;
    descricao?: string | null;
    empresa_id?: string | null;
  }): MemoriaCalculoPorNCM | null {
    const ncm = digitos(params.ncm);
    if (!ncm) return null;
    const agora = new Date().toISOString();
    const existente = MemoriaCalculoRepository.getAll().find(
      (m) =>
        digitos(m.ncm) === ncm &&
        m.tipo_decisao === params.tipo_decisao &&
        (m.empresa_id || null) === (params.empresa_id || null),
    );
    const registro: MemoriaCalculoPorNCM = {
      id: existente?.id || novoId(),
      empresa_id: params.empresa_id ?? null,
      ncm,
      descricao: params.descricao ?? existente?.descricao ?? null,
      tipo_decisao: params.tipo_decisao,
      parametros: (params.parametros || {}) as MemoriaCalculoPorNCM["parametros"],
      fundamento:
        params.fundamento ||
        `Usuário recalculou manualmente em ${agora.slice(0, 10)}`,
      criado_em: existente?.criado_em || agora,
      atualizado_em: agora,
      ativo: true,
    };
    return MemoriaCalculoRepository.upsert(registro);
  },

  atualizar(id: string, patch: Partial<MemoriaCalculoPorNCM>): MemoriaCalculoPorNCM | null {
    const atual = MemoriaCalculoRepository.findById(id);
    if (!atual) return null;
    return MemoriaCalculoRepository.upsert({
      ...atual,
      ...patch,
      id: atual.id,
      atualizado_em: new Date().toISOString(),
    });
  },

  desativarMemoria(id: string) {
    return MemoriaCalculoService.atualizar(id, { ativo: false });
  },
  ativarMemoria(id: string) {
    return MemoriaCalculoService.atualizar(id, { ativo: true });
  },
  excluirMemoria(id: string) {
    MemoriaCalculoRepository.remove(id);
  },

  /** Cria memória idêntica para outro NCM. */
  replicar(id: string, novoNcm: unknown): MemoriaCalculoPorNCM | null {
    const atual = MemoriaCalculoRepository.findById(id);
    if (!atual) return null;
    return MemoriaCalculoService.gravarMemoria({
      ncm: novoNcm,
      tipo_decisao: atual.tipo_decisao,
      parametros: atual.parametros,
      fundamento: `Replicado do NCM ${atual.ncm} em ${new Date().toISOString().slice(0, 10)}`,
      descricao: atual.descricao ?? null,
      empresa_id: atual.empresa_id ?? null,
    });
  },

  /** Memórias não atualizadas há mais de N dias. */
  antigas(dias = 90): MemoriaCalculoPorNCM[] {
    const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
    return MemoriaCalculoRepository.getAll().filter(
      (m) => new Date(m.atualizado_em).getTime() < limite,
    );
  },

  limparAntigas(dias = 90): number {
    const alvos = MemoriaCalculoService.antigas(dias);
    alvos.forEach((m) => MemoriaCalculoRepository.remove(m.id));
    return alvos.length;
  },

  exportarJSON(): string {
    return JSON.stringify(MemoriaCalculoService.listar(), null, 2);
  },

  exportarCSV(): string {
    const cab = "ncm;descricao;tipo_decisao;mva_informada;mva_utilizada;mva_ja_ajustada;fundamento;criado_em;atualizado_em;ativo";
    const linhas = MemoriaCalculoService.listar().map((m) => {
      const p = m.parametros || {};
      return [
        m.ncm,
        (m.descricao || "").replace(/;/g, ","),
        m.tipo_decisao,
        p.mva_informada ?? "",
        p.mva_utilizada ?? "",
        p.mva_ja_ajustada ? "sim" : "nao",
        (m.fundamento || "").replace(/;/g, ","),
        m.criado_em,
        m.atualizado_em,
        m.ativo ? "sim" : "nao",
      ].join(";");
    });
    return [cab, ...linhas].join("\n");
  },

  importarJSON(texto: string): number {
    let dados: unknown;
    try {
      dados = JSON.parse(texto);
    } catch {
      return 0;
    }
    if (!Array.isArray(dados)) return 0;
    let n = 0;
    for (const item of dados as MemoriaCalculoPorNCM[]) {
      const gravado = MemoriaCalculoService.gravarMemoria({
        ncm: item?.ncm,
        tipo_decisao: item?.tipo_decisao,
        parametros: item?.parametros,
        fundamento: item?.fundamento,
        descricao: item?.descricao ?? null,
        empresa_id: item?.empresa_id ?? null,
      });
      if (gravado) n++;
    }
    return n;
  },
};
