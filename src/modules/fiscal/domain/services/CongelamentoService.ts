// Service: CÁLCULO CONGELADO (lock manual definitivo).
// Quando o usuário altera manualmente o cálculo de um produto, o
// resultado é congelado e persistido. O sistema NUNCA descongela
// automaticamente — apenas por ação explícita do usuário.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { HistoricoApuracaoService } from "./HistoricoApuracaoService";

export interface ParametrosCongelados {
  base_calc: number;
  aliquota_icms: number;
  mva_utilizada?: number | null;
  mva_informada?: number | null;
  mva_ja_ajustada?: boolean;
  anexo_convenio_5291?: string | null;
  aliq_interna?: number;
  icms_proprio?: number;
  fcp_percentual?: number;
  pauta_aplicada?: string | null;
  presuncao_credito?: boolean;
  presuncao_credito_aliq?: number | null;
}

export interface CalculoCongelado {
  ativo: boolean;
  valor_icms: number;
  valor_icms_st: number;
  valor_icms_antecipacao: number;
  valor_difal: number;
  valor_fcp: number;
  tributacao: string;
  modo_decisao: string;
  parametros_utilizados: ParametrosCongelados;
  congelado_por: string;
  congelado_em: string;
  motivo: string;
  versoes_anteriores: Array<{
    versao_num: number;
    congelado_em: string;
    valores_congelados: Record<string, number>;
    motivo_mudanca: string;
  }>;
}

const num = (v: any) => Number(v) || 0;

function logTecnico(msg: string) {
  try {
    console.info(`[CONGELAMENTO] ${msg}`);
  } catch {
    /* noop */
  }
}

/** Congela o cálculo de um produto (retorna novo produto imutável). */
export function congelarCalculo(
  produto: any,
  novoCalculo: any,
  motivo = "",
  usuario = "Usuário",
): any {
  const agora = new Date().toISOString();
  const anterior: CalculoCongelado | undefined = produto?.calculo_congelado;

  const congelado: CalculoCongelado = {
    ativo: true,
    valor_icms: num(novoCalculo?.valor_icms_proprio ?? novoCalculo?.valor_icms),
    valor_icms_st: novoCalculo?.tributacao === "ICMS_ST" ? num(novoCalculo?.valor_icms_st) : 0,
    valor_icms_antecipacao:
      novoCalculo?.tributacao === "ANTECIPACAO" ? num(novoCalculo?.valor_icms_st) : 0,
    valor_difal: num(novoCalculo?.valor_difal),
    valor_fcp: num(novoCalculo?.valor_fcp_st) + num(novoCalculo?.valor_fcp),
    tributacao: novoCalculo?.tributacao || "NORMAL",
    modo_decisao: novoCalculo?.decisao_manual?.modo || "AUTO",
    parametros_utilizados: {
      base_calc: num(novoCalculo?.base_calc ?? novoCalculo?.base_icms),
      aliquota_icms: num(novoCalculo?.aliquota_aplicada),
      mva_utilizada: novoCalculo?.mva_utilizada ?? null,
      mva_informada:
        novoCalculo?.mva_informada ?? novoCalculo?.decisao_manual?.mva_informada ?? null,
      mva_ja_ajustada: !!(
        novoCalculo?.mva_ja_ajustada ?? novoCalculo?.decisao_manual?.mva_ja_ajustada
      ),
      anexo_convenio_5291: novoCalculo?.decisao_manual?.anexo_convenio_5291 || null,
      aliq_interna: num(novoCalculo?.aliq_interna),
      icms_proprio: num(novoCalculo?.valor_icms_proprio),
      fcp_percentual: num(novoCalculo?.fcp_percentual),
      pauta_aplicada: novoCalculo?.fonte_pauta || novoCalculo?.metodo_pauta || null,
      presuncao_credito: !!novoCalculo?.icms_proprio_presumido,
      presuncao_credito_aliq: novoCalculo?.icms_proprio_presumido
        ? num(novoCalculo?.aliquota_aplicada)
        : null,
    },
    congelado_por: usuario || "Sistema",
    congelado_em: agora,
    motivo: motivo || `Usuário recalculou como ${novoCalculo?.tributacao || "—"}`,
    versoes_anteriores: anterior?.ativo
      ? [
          {
            versao_num: (anterior.versoes_anteriores?.length || 0) + 1,
            congelado_em: anterior.congelado_em,
            valores_congelados: {
              icms: anterior.valor_icms,
              st: anterior.valor_icms_st,
              antec: anterior.valor_icms_antecipacao,
              difal: anterior.valor_difal,
              fcp: anterior.valor_fcp,
            },
            motivo_mudanca: `Substituído por nova alteração manual em ${agora}`,
          },
          ...(anterior.versoes_anteriores || []),
        ]
      : anterior?.versoes_anteriores || [],
  };

  logTecnico(
    `NCM ${produto?.ncm || "—"} item ${produto?.seq ?? "—"} congelado (${congelado.tributacao}) — ${congelado.motivo}`,
  );
  return { ...produto, calculo_congelado: congelado };
}

/**
 * Congela e registra a decisão no histórico que alimenta a Memória Protegida.
 */
export function congelarCalculoComMemoria(
  produto: any,
  novoCalculo: any,
  motivo = "",
  usuario = "Usuário",
  empresaId?: string | null,
): any {
  const congelado = congelarCalculo(produto, novoCalculo, motivo, usuario);
  const emp = String(empresaId ?? "").trim();

  // Histórico de apuração (fonte exclusiva da Memória Protegida).
  try {
    if (produto?.ncm && emp) {
      HistoricoApuracaoService.registrarAutomaticamenteNaMemoria({
        ncm: produto.ncm,
        descricao: produto.descricao || null,
        calculo: {
          ...novoCalculo,
          _congelado: true,
          _congelado_em: congelado?.calculo_congelado?.congelado_em,
          _congelado_por: usuario,
        } as any,
        tipoCalculo: "MANUAL_CONGELADO",
        usuario,
        empresaId: emp,
        notaOrigem: null,
        aliquotaInterestadual: null,
      } as any);
    }
  } catch (e) {
    logTecnico(`Aviso: histórico não registrado — ${e}`);
  }

  return congelado;
}

/** Descongela: desativa o lock preservando o histórico de versões. */
export function descongelarCalculo(produto: any): any {
  const antigo: CalculoCongelado | undefined = produto?.calculo_congelado;
  if (!antigo) return produto;
  const agora = new Date().toISOString();
  logTecnico(`NCM ${produto?.ncm || "—"} item ${produto?.seq ?? "—"} DESCONGELADO pelo usuário.`);
  return {
    ...produto,
    calculo_congelado: {
      ...antigo,
      ativo: false,
      versoes_anteriores: [
        {
          versao_num: (antigo.versoes_anteriores?.length || 0) + 1,
          congelado_em: antigo.congelado_em,
          valores_congelados: {
            icms: antigo.valor_icms,
            st: antigo.valor_icms_st,
            antec: antigo.valor_icms_antecipacao,
            difal: antigo.valor_difal,
            fcp: antigo.valor_fcp,
          },
          motivo_mudanca: `Descongelado pelo usuário em ${agora}`,
        },
        ...(antigo.versoes_anteriores || []),
      ],
    },
  };
}

export const estaCongelado = (produto: any): boolean => !!produto?.calculo_congelado?.ativo;

/**
 * Sempre que o sistema precisar EXIBIR um cálculo (UI, PDF, CSV,
 * Arquivo Fiscal), passa por aqui: congelado tem precedência máxima.
 */
export function obterCalculoExibivel(produto: any, calculoAutomatico: any): any {
  const cg: CalculoCongelado | undefined = produto?.calculo_congelado;
  if (!cg?.ativo) return calculoAutomatico;

  const p = cg.parametros_utilizados || ({} as ParametrosCongelados);
  const valorST = cg.valor_icms_st || cg.valor_icms_antecipacao || 0;

  if (
    calculoAutomatico &&
    (calculoAutomatico.tributacao !== cg.tributacao ||
      Math.abs(num(calculoAutomatico.valor_icms_st) - valorST) > 0.01)
  ) {
    logTecnico(
      `[IGNORADO_CONGELADO] Recálculo automático (${calculoAutomatico.tributacao}) ignorado para NCM ${produto?.ncm || "—"} — exibindo valor congelado (${cg.tributacao}).`,
    );
  }

  return {
    ...calculoAutomatico,
    tributacao: cg.tributacao,
    base_calc: p.base_calc ?? calculoAutomatico?.base_calc,
    aliquota_aplicada: p.aliquota_icms ?? calculoAutomatico?.aliquota_aplicada,
    aliq_interna: p.aliq_interna ?? calculoAutomatico?.aliq_interna,
    mva_utilizada: p.mva_utilizada ?? calculoAutomatico?.mva_utilizada,
    mva_informada: p.mva_informada ?? calculoAutomatico?.mva_informada,
    mva_ja_ajustada: !!p.mva_ja_ajustada,
    fcp_percentual: p.fcp_percentual ?? calculoAutomatico?.fcp_percentual,
    valor_icms_proprio: cg.valor_icms,
    valor_icms_st: valorST,
    valor_difal: cg.valor_difal,
    valor_fcp_st: cg.valor_fcp,
    valor_icms_total: cg.valor_icms + valorST + cg.valor_difal + cg.valor_fcp,
    icms_proprio_presumido: !!p.presuncao_credito,
    decisao_manual: {
      modo: cg.modo_decisao,
      mva_informada: p.mva_informada ?? null,
      mva_ja_ajustada: !!p.mva_ja_ajustada,
      anexo_convenio_5291: p.anexo_convenio_5291 || null,
      congelado: true,
    },
    _congelado: true,
    _congelado_em: cg.congelado_em,
    _congelado_por: cg.congelado_por,
    _motivo_congelamento: cg.motivo,
    _parametros_congelados: p,
  };
}

export const CongelamentoService = {
  congelarCalculo,
  congelarCalculoComMemoria,
  descongelarCalculo,
  obterCalculoExibivel,
  estaCongelado,
};
