/**
 * SERVICE: Memória de ST com Variações de MVA por Alíquota ICMS
 */

import { MemoriaCalculoRepository } from "../repositories/MemoriaCalculoRepository";
import type { MemoriaCalculoPorNCM } from "../entities/memoriaCalculo";

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `mem_st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logTecnico(msg: string) {
  try {
    console.info(`[MEMORIA_ST] ${msg}`);
  } catch {
    /* noop */
  }
}

/** Faixas de alíquota interestadual da memória: sempre 4%, 7% ou 12%. */
type FaixaMVA = "4" | "7" | "12";

function classificarFaixaMVA(aliquota: number): FaixaMVA {
  const n = Number(aliquota) || 0;
  if (n <= 5) return "4";
  if (n <= 9) return "7";
  return "12";
}

function nomeCampoMVA(faixa: FaixaMVA): string {
  return {
    "4": "mva_tabela_4",
    "7": "mva_tabela_7",
    "12": "mva_tabela_12",
  }[faixa];
}


export const MemoriaSTService = {
  classificarFaixaMVA,

  /** Busca a melhor memória ST para um NCM, considerando a alíquota do ICMS. */
  obterMemoriaSTporAliquota(
    ncm: unknown,
    aliquota: number,
    empresaId?: string | null,
  ): MemoriaCalculoPorNCM | null {
    const nd = digitos(ncm);
    if (!nd) return null;

    const emp = String(empresaId ?? "").trim();
    if (!emp) {
      logTecnico("[ISOLAMENTO_VIOLADO] obterMemoriaSTporAliquota chamado sem empresa_id");
      return null;
    }

    const memorias = MemoriaCalculoRepository.getAll().filter((m) => {
      const mncd = digitos(m.ncm);
      return (
        mncd === nd &&
        m.tipo_decisao === "ST_MANUAL" &&
        String(m.empresa_id ?? "") === emp &&
        m.ativo
      );
    });

    if (!memorias.length) return null;

    const faixaAtual = classificarFaixaMVA(aliquota);
    const aliqExata = memorias.find((m) => {
      const maliq = (m.parametros?.aliquota_origem_st ?? 18) as number;
      return classificarFaixaMVA(maliq) === faixaAtual;
    });

    if (aliqExata) {
      logTecnico(`NCM ${nd} alíquota ${aliquota}% encontrou memória ST na faixa ${faixaAtual}`);
      return aliqExata;
    }

    const sorted = [...memorias].sort((a, b) => {
      const aAliq = (a.parametros?.aliquota_origem_st ?? 18) as number;
      const bAliq = (b.parametros?.aliquota_origem_st ?? 18) as number;
      return Math.abs(aAliq - aliquota) - Math.abs(bAliq - aliquota);
    });

    logTecnico(`NCM ${nd} alíquota ${aliquota}% sem faixa exata, usando proximidade`);
    return sorted[0] ?? null;
  },

  /** Extrai a MVA correta de uma memória, baseado na alíquota. */
  obterMVAparaAliquota(
    ncm: unknown,
    aliquota: number,
    empresaId?: string | null,
  ): { mva: number; ja_ajustada: boolean; fonte: string } | null {
    const mem = MemoriaSTService.obterMemoriaSTporAliquota(ncm, aliquota, empresaId);
    if (!mem?.parametros) return null;

    const p = mem.parametros as Record<string, unknown>;
    const faixa = classificarFaixaMVA(aliquota);
    const campo = nomeCampoMVA(faixa);
    const mvaEspecifico = (p[campo] as number | undefined) ?? null;
    const mvaGenerico = (p.mva_utilizada as number | undefined) ?? null;
    const mva = mvaEspecifico ?? mvaGenerico;

    if (mva === null || mva === undefined) return null;

    return {
      mva: mva as number,
      ja_ajustada: !!(p.mva_ja_ajustada as boolean | undefined),
      fonte: mvaEspecifico != null ? `mva_tabela_${faixa}` : "mva_utilizada",
    };
  },

  /** Grava ou atualiza memória ST com suporte a múltiplas alíquotas. */
  gravarMemoriaST(params: {
    ncm: unknown;
    descricao?: string | null;
    aliquota_origem: number;
    mva_utilizada: number | null;
    mva_ja_ajustada?: boolean;
    empresa_id?: string | null;
    fundamento?: string;
  }): MemoriaCalculoPorNCM | null {
    const ncm = digitos(params.ncm);
    if (!ncm || params.mva_utilizada == null) return null;

    const emp = String(params.empresa_id ?? "").trim();
    if (!emp) {
      logTecnico("[ISOLAMENTO_VIOLADO] gravarMemoriaST chamado sem empresa_id");
      return null;
    }

    const aliq = Number(params.aliquota_origem) || 0;
    const faixa = classificarFaixaMVA(aliq);
    const campoDest = nomeCampoMVA(faixa);
    const agora = new Date().toISOString();

    const existente = MemoriaCalculoRepository.getAll().find(
      (m) =>
        digitos(m.ncm) === ncm &&
        m.tipo_decisao === "ST_MANUAL" &&
        String(m.empresa_id ?? "") === emp,
    );

    const parametrosBase = existente?.parametros || {};
    const novosParametros = {
      ...parametrosBase,
      mva_utilizada: params.mva_utilizada,
      mva_informada: params.mva_utilizada,
      mva_ja_ajustada: !!params.mva_ja_ajustada,
      aliquota_origem_st: aliq,
      modo_calculo: "ICMS_ST",
      [campoDest]: params.mva_utilizada,
    };

    const registro: MemoriaCalculoPorNCM = {
      id: existente?.id || novoId(),
      empresa_id: emp,
      ncm,
      descricao: params.descricao ?? existente?.descricao ?? null,
      tipo_decisao: "ST_MANUAL",
      parametros: novosParametros as MemoriaCalculoPorNCM["parametros"],
      fundamento: params.fundamento || `ST (aliq ${aliq}%) gravado em ${agora.slice(0, 10)}`,
      criado_em: existente?.criado_em || agora,
      atualizado_em: agora,
      ativo: true,
    };

    MemoriaCalculoRepository.upsert(registro);
    logTecnico(
      `NCM ${ncm} empresa ${emp.slice(0, 8)}… ${campoDest}=${params.mva_utilizada}% armazenada`,
    );
    return registro;
  },

  /** Lista todas as variações de MVA para um NCM. */
  listarVariacoesNCM(
    ncm: unknown,
    empresaId?: string | null,
  ): Array<{
    memoria: MemoriaCalculoPorNCM;
    faixa: FaixaMVA;
    aliquota: number;
    mva: number | null;
  }> {
    const nd = digitos(ncm);
    if (!nd) return [];
    const emp = String(empresaId ?? "").trim();
    if (!emp) return [];

    const memorias = MemoriaCalculoRepository.getAll().filter(
      (m) =>
        digitos(m.ncm) === nd &&
        m.tipo_decisao === "ST_MANUAL" &&
        String(m.empresa_id ?? "") === emp &&
        m.ativo,
    );

    return memorias.map((mem) => {
      const p = (mem.parametros || {}) as Record<string, unknown>;
      const aliq = (p.aliquota_origem_st as number | undefined) ?? 18;
      const faixa = classificarFaixaMVA(aliq);
      const campo = nomeCampoMVA(faixa);
      const mva =
        (p[campo] as number | undefined) ?? (p.mva_utilizada as number | undefined) ?? null;
      return { memoria: mem, faixa, aliquota: aliq, mva };
    });
  },

  /** Estatísticas sobre memória ST. */
  estatisticasNCM(
    ncm: unknown,
    empresaId?: string | null,
  ): {
    total_variacoes: number;
    faixas_cobertas: string[];
    aliquotas_registradas: number[];
    ultima_atualizacao?: string;
  } {
    const variacoes = MemoriaSTService.listarVariacoesNCM(ncm, empresaId);
    return {
      total_variacoes: variacoes.length,
      faixas_cobertas: Array.from(new Set(variacoes.map((v) => v.faixa))).sort(),
      aliquotas_registradas: variacoes.map((v) => v.aliquota).sort((a, b) => a - b),
      ultima_atualizacao: variacoes[0]?.memoria?.atualizado_em,
    };
  },

  /** Export para auditoria. */
  exportarVariacoesCSV(ncm: unknown, empresaId?: string | null): string {
    const variacoes = MemoriaSTService.listarVariacoesNCM(ncm, empresaId);
    if (!variacoes.length) return "";
    return [
      "ncm;aliquota;faixa;mva;mva_ja_ajustada;criado_em;atualizado_em",
      ...variacoes.map((v) => {
        const p = (v.memoria.parametros || {}) as Record<string, unknown>;
        return [
          v.memoria.ncm,
          v.aliquota,
          v.faixa,
          v.mva ?? "",
          (p.mva_ja_ajustada as boolean | undefined) ? "sim" : "nao",
          v.memoria.criado_em,
          v.memoria.atualizado_em,
        ].join(";");
      }),
    ].join("\n");
  },
};
