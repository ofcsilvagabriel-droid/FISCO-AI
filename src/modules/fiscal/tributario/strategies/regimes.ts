// Strategies de regime. Cada regime é um plugin: adicionar um novo
// regime = adicionar uma strategy e registrá-la na factory.
import type { ContextoRegime, PerfilProduto, RegimeStrategy, ResultadoJuridico } from "../types";

const UF_BA = "BA";

export const STStrategy: RegimeStrategy = {
  regime: "ICMS_ST",
  detectar(_perfil, juridico) {
    const c = juridico.candidatos.find((x) => x.norma.regime === "ICMS_ST");
    if (!c) return null;
    return {
      regime: "ICMS_ST",
      aplicavel: true,
      normaId: c.norma.id,
      fundamento: c.norma.fundamento,
      detalhes: {
        item: c.norma.item,
        cest: c.norma.cest,
        acordo: c.norma.acordo,
        protocolos: c.norma.protocolos,
        convenios: c.norma.convenios,
        mva_original: c.norma.mvaOriginal,
        mva_ajustada_4: c.norma.mvaAjustada4,
        mva_ajustada_7: c.norma.mvaAjustada7,
        mva_ajustada_12: c.norma.mvaAjustada12,
        ufs_signatarias: c.norma.ufsSignatarias,
      },
    };
  },
};

export const AntecipacaoStrategy: RegimeStrategy = {
  regime: "ANTECIPACAO",
  detectar(perfil, juridico) {
    const interestadual = !!perfil.ufOrigem && !!perfil.ufDestino && perfil.ufOrigem !== perfil.ufDestino;
    const destinoBA = perfil.ufDestino === UF_BA;
    const temST = juridico.candidatos.some((x) => x.norma.regime === "ICMS_ST");
    if (!interestadual || !destinoBA) return null;
    return {
      regime: "ANTECIPACAO",
      aplicavel: !temST,
      normaId: null,
      fundamento: "RICMS/BA – Decreto 13.780/2012, Art. 12-A (antecipação parcial)",
      detalhes: { motivo: temST ? "Mercadoria enquadrada em ST — antecipação parcial afastada." : "Entrada interestadual de mercadoria para comercialização sem ST." },
    };
  },
};

export const DifalStrategy: RegimeStrategy = {
  regime: "DIFAL",
  detectar(perfil, juridico) {
    const interestadual = !!perfil.ufOrigem && !!perfil.ufDestino && perfil.ufOrigem !== perfil.ufDestino;
    if (!interestadual) return null;
    const temST = juridico.candidatos.some((x) => x.norma.regime === "ICMS_ST");
    return {
      regime: "DIFAL",
      aplicavel: !temST,
      normaId: null,
      fundamento: "EC 87/2015 e LC 190/2022 — diferencial de alíquotas",
      detalhes: { origem: perfil.ufOrigem, destino: perfil.ufDestino, afastado_por_st: temST },
    };
  },
};

export const ReducaoBCStrategy: RegimeStrategy = {
  regime: "REDUCAO_BC",
  detectar(_perfil, juridico) {
    const c = juridico.candidatos.find((x) => x.norma.regime === "REDUCAO_BC");
    if (!c) return null;
    return {
      regime: "REDUCAO_BC",
      aplicavel: true,
      normaId: c.norma.id,
      fundamento: c.norma.fundamento,
      detalhes: { reducoes: c.norma.reducoes, item: c.norma.item, convenios: c.norma.convenios },
    };
  },
};

/** Regimes com arquitetura pronta, ainda sem regra própria implementada. */
function placeholder(regime: RegimeStrategy["regime"], fundamento: string): RegimeStrategy {
  return {
    regime,
    detectar(): ContextoRegime | null {
      return { regime, aplicavel: false, normaId: null, fundamento, detalhes: { status: "AGUARDANDO_REGRAS" } };
    },
  };
}

export const STRATEGIES_PADRAO: RegimeStrategy[] = [
  STStrategy,
  AntecipacaoStrategy,
  DifalStrategy,
  ReducaoBCStrategy,
  placeholder("MONOFASICO", "LC 192/2022 — regime monofásico"),
  placeholder("CREDITO_PRESUMIDO", "Legislação estadual de crédito presumido"),
  placeholder("SUSPENSAO", "Hipóteses de suspensão do ICMS"),
  placeholder("ISENCAO", "Hipóteses de isenção"),
  placeholder("DIFERIMENTO", "Hipóteses de diferimento"),
  placeholder("FCP", "Fundo de Combate à Pobreza"),
  placeholder("FCP_ST", "FCP incidente sobre a substituição tributária"),
  placeholder("BENEFICIO", "Reservado ao futuro Motor de Benefícios"),
];

export type { RegimeStrategy, PerfilProduto, ResultadoJuridico };
