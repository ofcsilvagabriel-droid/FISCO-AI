// =====================================================================
// SERVICE — LEGISLAÇÃO VINCULADA À MEMÓRIA FISCAL
// ---------------------------------------------------------------------
// Consolida, para um NCM, TODAS as fontes legais que o sistema conhece
// (RICMS/BA Anexo 1, Conv. 52/91, Conv. 142/18 + Prot. 41/08 e 97/10,
// Cesta Básica BA) já com o NÍVEL DE ADERÊNCIA do NCM e a MVA por faixa
// de alíquota interestadual.
//
// Regras mantidas do motor:
//  · RICMS/BA tem PRIORIDADE sobre convênios/protocolos;
//  · Conv. 142/18 e Prot. 41/08 e 97/10 são EXCLUSIVOS para autopeças;
//  · descrição NUNCA concede benefício sozinha (só reforça/diverge).
// =====================================================================
import { RicmsBaRepository } from "../repositories/RicmsBaRepository";
import { Conv5291Repository } from "../repositories/Conv5291Repository";
import { CONV_142_18 } from "../../data/conv142_18";
import { avaliarCestaBasicaBA } from "../../engines/motorCestaBasicaBA";

const digs = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export type NivelNCM = "EXATO_8" | "SUBPOSICAO_6" | "POSICAO_4" | "CAPITULO_2" | "SEM_ADERENCIA";

export interface NormaVinculada {
  fonte: "RICMS_BA" | "CONV_52_91" | "CONV_142_18" | "CESTA_BASICA_BA";
  id: string;
  ncm: string;
  cest?: string | null;
  descricao: string;
  segmento?: string | null;
  fundamento: string;
  nivel: NivelNCM;
  digitos: number;
  prioridade: number; // 1 = maior (RICMS/BA)
  mva?: { "4": string | null; "7": string | null; "12": string | null } | null;
  extra?: Record<string, unknown>;
}

export function nivelAderencia(ncmProduto: unknown, ncmNorma: unknown): { nivel: NivelNCM; digitos: number } {
  const a = digs(ncmProduto);
  const b = digs(ncmNorma);
  if (!a || !b) return { nivel: "SEM_ADERENCIA", digitos: 0 };
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  const ref = Math.min(b.length, 8);
  if (n >= 8 && ref >= 8) return { nivel: "EXATO_8", digitos: n };
  if (n >= 6 && ref >= 6) return { nivel: "SUBPOSICAO_6", digitos: n };
  if (n >= 4) return { nivel: "POSICAO_4", digitos: n };
  if (n >= 2) return { nivel: "CAPITULO_2", digitos: n };
  return { nivel: "SEM_ADERENCIA", digitos: n };
}

const ORDEM_NIVEL: Record<NivelNCM, number> = {
  EXATO_8: 4, SUBPOSICAO_6: 3, POSICAO_4: 2, CAPITULO_2: 1, SEM_ADERENCIA: 0,
};

export interface ConsultaLegislacao {
  ncm: string;
  normas: NormaVinculada[];
  principal: NormaVinculada | null;
  regimes: string[];
  avisos: string[];
}

export const LegislacaoMemoriaService = {
  nivelAderencia,

  /** Consulta consolidada das fontes legais para um NCM. */
  consultar(
    ncm: unknown,
    opts: {
      descricao?: string | null;
      segmento?: string | null;
      ufOrigem?: string | null;
      ufDestino?: string | null;
      aliquotaInterna?: number | null;
    } = {},
  ): ConsultaLegislacao {
    const n = digs(ncm);
    const normas: NormaVinculada[] = [];
    const avisos: string[] = [];
    if (!n) return { ncm: "", normas, principal: null, regimes: [], avisos: ["NCM não informado."] };

    // --- 1) RICMS/BA — base principal de ST
    for (const r of RicmsBaRepository.buscarPorNCM(n) as unknown as Record<string, string>[]) {
      const { nivel, digitos } = nivelAderencia(n, r["ncm"]);
      if (nivel === "SEM_ADERENCIA") continue;
      normas.push({
        fonte: "RICMS_BA",
        id: r["id"] || `RICMS_${r["cest"] || r["ncm"]}`,
        ncm: r["ncm"] || "",
        cest: r["cest"] || null,
        descricao: r["descricao"] || "",
        segmento: r["segmento"] || null,
        fundamento: r["fundamento"] || "RICMS/BA – Decreto 13.780/2012 – Anexo 1",
        nivel,
        digitos,
        prioridade: 1,
        mva: {
          "4": r["mva_ajustada_4"] || null,
          "7": r["mva_ajustada_7"] || null,
          "12": r["mva_ajustada_12"] || null,
        },
        extra: { item: r["item"], acordo: r["acordo"], tipo: r["tipo"] },
      });
    }

    // --- 2) Convênio 52/91 — redução de base (aderência exige NCM completo)
    const c52 = Conv5291Repository.identificar(n) as
      | { tipo: string; anexo: string; regra: Record<string, string> }
      | null;
    if (c52) {
      const aliq = Number(opts.aliquotaInterna) || 0;
      const carga = Number(
        Conv5291Repository.cargaEfetiva(c52.tipo, opts.ufOrigem || "", opts.ufDestino || ""),
      ) || 0;
      normas.push({
        fonte: "CONV_52_91",
        id: `C5291_${c52.anexo}_${c52.regra["ncm"]}`,
        ncm: c52.regra["ncm"] || n,
        cest: null,
        descricao: c52.regra["descricao"] || "",
        segmento: c52.tipo === "INDUSTRIAL" ? "Máquinas e implementos industriais" : "Máquinas e implementos agrícolas",
        fundamento: c52.regra["fundamento"] || `Convênio ICMS 52/91 — Anexo ${c52.anexo}`,
        nivel: "EXATO_8",
        digitos: 8,
        prioridade: 2,
        mva: null,
        extra: {
          anexo: c52.anexo,
          tipo: c52.tipo,
          carga_efetiva: carga,
          perc_base_reduzida: aliq > 0 ? carga / aliq : null,
        },
      });
    }

    // --- 3) Convênio 142/18 (+ Prot. 41/08 e 97/10) — EXCLUSIVO autopeças
    if (CONV_142_18.isAutopeca(n)) {
      const seg = String(opts.segmento || "").toUpperCase();
      const ehAutopeca = !seg || seg.includes("AUTOPEC") || seg.includes("AUTOPEÇ") || seg.includes("VEIC");
      if (ehAutopeca) {
        normas.push({
          fonte: "CONV_142_18",
          id: `C14218_${n}`,
          ncm: n,
          cest: null,
          descricao: "Autopeças — mercadoria relacionada no Convênio ICMS 142/18",
          segmento: "AUTOPEÇAS",
          fundamento: "Convênio ICMS 142/18 (c/c Prot. ICMS 41/08 e 97/10) — regime de ST de autopeças",
          nivel: "POSICAO_4",
          digitos: 4,
          prioridade: 3,
          mva: null,
          extra: {
            mva_interna_ba: CONV_142_18.mva_padrao_interno_ba,
            mva_aquisicoes: CONV_142_18.mva_padrao_aquisicoes,
            observacao: "Aplicável apenas quando o produto for efetivamente autopeça.",
          },
        });
      } else {
        avisos.push(
          "NCM consta no Convênio 142/18, mas o segmento do produto não é autopeças — enquadramento NÃO aplicado (revisão manual).",
        );
      }
    }

    // --- 4) Cesta Básica BA
    try {
      const cesta = avaliarCestaBasicaBA({ ncm: n, descricao: opts.descricao || "" }) as Record<string, unknown>;
      if (cesta && (cesta["pertence_cesta"] || cesta["pertenceCesta"])) {
        normas.push({
          fonte: "CESTA_BASICA_BA",
          id: `CESTA_${n}`,
          ncm: n,
          cest: null,
          descricao: String(cesta["produto"] || cesta["descricao"] || "Produto da cesta básica"),
          segmento: "CESTA BÁSICA",
          fundamento: String(cesta["fundamento"] || "RICMS/BA — cesta básica (operação interna)"),
          nivel: (cesta["nivel_match"] as NivelNCM) || "POSICAO_4",
          digitos: 6,
          prioridade: 2,
          mva: null,
          extra: cesta,
        });
        if (cesta["divergencia_ncm_descricao"]) {
          avisos.push("Divergência entre NCM e descrição na cesta básica — confirme o produto antes de aplicar o benefício.");
        }
      }
    } catch {
      /* base opcional */
    }

    normas.sort(
      (a, b) =>
        ORDEM_NIVEL[b.nivel] - ORDEM_NIVEL[a.nivel] ||
        a.prioridade - b.prioridade ||
        b.digitos - a.digitos,
    );

    const principal = normas[0] || null;
    if (principal && principal.nivel !== "EXATO_8" && principal.fonte === "RICMS_BA") {
      avisos.push(
        `Aderência de NCM apenas em nível ${principal.nivel.replace("_", " ")} — confirme a descrição antes de manter o enquadramento.`,
      );
    }
    if (!normas.length) avisos.push("Nenhuma norma localizada para este NCM nas bases carregadas.");

    const regimes = [
      ...new Set(
        normas.map((x) =>
          x.fonte === "RICMS_BA" || x.fonte === "CONV_142_18"
            ? "ICMS_ST"
            : x.fonte === "CONV_52_91"
              ? "BASE_REDUZIDA"
              : "BENEFICIO",
        ),
      ),
    ];

    return { ncm: n, normas, principal, regimes, avisos };
  },

  /** MVA prevista no RICMS/BA para a faixa de alíquota interestadual da memória. */
  mvaDaFaixa(consulta: ConsultaLegislacao, faixa: unknown): string | null {
    const f = String(faixa ?? "").replace(/\D/g, "");
    if (!["4", "7", "12"].includes(f)) return null;
    const ricms = consulta.normas.find((x) => x.fonte === "RICMS_BA" && x.mva);
    return (ricms?.mva as Record<string, string | null> | undefined)?.[f] || null;
  },

  /**
   * Confronta a decisão gravada na memória com a legislação encontrada.
   * Nunca altera a decisão — apenas sinaliza divergências para revisão.
   */
  conferirDecisao(
    consulta: ConsultaLegislacao,
    decisao: { regime?: string | null; mva_informada?: number | null; faixa?: string | null },
  ): { coerente: boolean; divergencias: string[]; mva_legal: string | null } {
    const divergencias: string[] = [];
    const regime = String(decisao.regime || "").toUpperCase();
    const temST = consulta.regimes.includes("ICMS_ST");

    if (temST && regime && !regime.includes("ST")) {
      divergencias.push("Legislação prevê ICMS-ST para este NCM, mas a decisão memorizada não é ST.");
    }
    if (!temST && regime.includes("ST")) {
      divergencias.push("Decisão memorizada é ST, mas nenhuma norma de ST foi localizada para este NCM.");
    }

    const mvaLegalTxt = LegislacaoMemoriaService.mvaDaFaixa(consulta, decisao.faixa);
    if (mvaLegalTxt && decisao.mva_informada != null) {
      const legal = Number(String(mvaLegalTxt).replace(/[^\d,.-]/g, "").replace(".", "").replace(",", "."));
      const usada = Number(decisao.mva_informada);
      if (Number.isFinite(legal) && Math.abs(legal - usada) > 0.01) {
        divergencias.push(`MVA memorizada (${usada}%) difere da MVA do RICMS/BA para a faixa (${mvaLegalTxt}).`);
      }
    }

    return { coerente: divergencias.length === 0, divergencias, mva_legal: mvaLegalTxt };
  },
};

export default LegislacaoMemoriaService;
