// Repositório indexado da legislação estruturada.
// Fonte principal: base do Anexo I do RICMS/BA já existente no sistema.
// Complementos: Convênio ICMS 52/91 (industrial e agrícola).
// NUNCA consulta PDFs — apenas a base estruturada.
import { RICMS_BA_ANEXO1 } from "../../data/ricmsBaAnexo1";
import { CONV_52_91_INDUSTRIAL, CONV_52_91_AGRICOLA } from "../../data/conv5291";
import { NcmNormalizer } from "../normalizers/NcmNormalizer";
import type { NormaTributaria, RegimeTributario } from "../types";

type Bruto = Record<string, unknown>;

const s = (v: unknown) => (v == null ? "" : String(v));
const pct = (v: unknown): number | null => {
  const n = parseFloat(s(v).replace("%", "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

function extrairNotas(texto: string): string[] {
  const notas: string[] = [];
  const re = /Nota[s]?\s*:?\s*([^"]{10,400})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) notas.push(m[1]!.trim());
  return notas;
}

function extrairExcecoes(texto: string, descricao: string): string[] {
  const out: string[] = [];
  const alvo = `${descricao} ${texto}`;
  const re = /(exceto[^.;]{3,200}|excluíd[oa][^.;]{0,200}|não se aplica[^.;]{3,200}|revogad[oa][^.;]{0,120})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(alvo))) out.push(m[1]!.trim());
  return [...new Set(out)];
}

function extrairAcordos(texto: string, acordo: string): { protocolos: string[]; convenios: string[] } {
  const alvo = `${acordo} ${texto}`;
  const protocolos = new Set<string>();
  const convenios = new Set<string>();
  const re = /(Prot(?:ocolo)?\.?\s*ICM?S?\s*\d+\/\d{2}|Conv(?:ênio|enio)?\.?\s*ICM?S?\s*\d+\/\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(alvo))) {
    const v = m[1]!.replace(/\s+/g, " ").trim();
    if (/^prot/i.test(v)) protocolos.add(v);
    else convenios.add(v);
  }
  return { protocolos: [...protocolos], convenios: [...convenios] };
}

function extrairUFs(texto: string, acordo: string): NormaTributaria["ufsSignatarias"] {
  const alvo = `${acordo} ${texto}`;
  const exceto = alvo.match(/Todos,?\s*exceto\s+([A-Z]{2}(?:[,\s e]+[A-Z]{2})*)/);
  if (exceto) {
    return { modo: "TODOS_EXCETO", ufs: (exceto[1]!.match(/[A-Z]{2}/g) || []) };
  }
  return { modo: "TODOS", ufs: [] };
}

function mapRicms(r: Bruto): NormaTributaria {
  const texto = s(r["texto_original"]);
  const descricao = s(r["descricao"]);
  const acordo = s(r["acordo"]);
  const { protocolos, convenios } = extrairAcordos(texto, acordo);
  const ncms = new Set<string>();
  const base = NcmNormalizer.digitos(r["ncm"]);
  if (base) ncms.add(base);
  for (const n of NcmNormalizer.extrairDeTexto(texto)) ncms.add(n);

  return {
    id: s(r["id"]),
    regime: (s(r["tipo"]).toUpperCase() === "ICMS_ST" ? "ICMS_ST" : "REDUCAO_BC") as RegimeTributario,
    fonte: "RICMS/BA – Decreto 13.780/2012 – Anexo 1",
    fundamento: s(r["fundamento"]) || "RICMS/BA Anexo 1",
    item: s(r["item"]),
    cest: s(r["cest"]) || null,
    ncms: [...ncms],
    descricaoLegal: descricao,
    segmento: s(r["segmento"]),
    acordo,
    protocolos,
    convenios,
    ufsSignatarias: extrairUFs(texto, acordo),
    notas: extrairNotas(texto),
    observacoes: [],
    excecoes: extrairExcecoes(texto, descricao),
    mvaOriginal: pct(r["mva_original"]),
    mvaAjustada4: pct(r["mva_ajustada_4"]),
    mvaAjustada7: pct(r["mva_ajustada_7"]),
    mvaAjustada12: pct(r["mva_ajustada_12"]),
    reducoes: [],
    beneficios: [],
    bruto: r,
  };
}

function mapConv(r: Bruto, rotulo: string): NormaTributaria {
  const descricao = s(r["descricao"]);
  return {
    id: s(r["id"]),
    regime: "REDUCAO_BC",
    fonte: `Convênio ICMS 52/91 – ${rotulo}`,
    fundamento: s(r["fundamento"]),
    item: s(r["item"]),
    cest: null,
    ncms: [NcmNormalizer.digitos(r["ncm"])].filter(Boolean),
    descricaoLegal: descricao,
    segmento: rotulo === "Industrial" ? "MÁQUINAS E APARELHOS INDUSTRIAIS" : "PRODUTOS AGROPECUÁRIOS",
    acordo: "Convênio ICMS 52/91",
    protocolos: [],
    convenios: ["Convênio ICMS 52/91"],
    ufsSignatarias: { modo: "TODOS", ufs: [] },
    notas: [],
    observacoes: [],
    excecoes: extrairExcecoes("", descricao),
    mvaOriginal: null, mvaAjustada4: null, mvaAjustada7: null, mvaAjustada12: null,
    reducoes: [
      { tipo: "CARGA_INTERNA", cargaEfetiva: pct(r["carga_interna"]), descricao: "Carga efetiva em operação interna" },
      { tipo: "CARGA_INTER_SUL_SUDESTE", cargaEfetiva: pct(r["carga_inter_sul_sudeste"]), descricao: "Carga efetiva interestadual Sul/Sudeste" },
      { tipo: "CARGA_INTER_DEMAIS", cargaEfetiva: pct(r["carga_inter_demais"]), descricao: "Carga efetiva interestadual demais regiões" },
    ],
    beneficios: ["Redução de base de cálculo — Convênio ICMS 52/91"],
    bruto: r,
  };
}

let CACHE: NormaTributaria[] | null = null;
let INDICE_POSICAO: Map<string, NormaTributaria[]> | null = null;
let INDICE_CEST: Map<string, NormaTributaria[]> | null = null;

function construir(): NormaTributaria[] {
  if (CACHE) return CACHE;
  const normas: NormaTributaria[] = [
    ...(RICMS_BA_ANEXO1 as Bruto[]).map(mapRicms),
    ...(CONV_52_91_INDUSTRIAL as Bruto[]).map((r) => mapConv(r, "Industrial")),
    ...(CONV_52_91_AGRICOLA as Bruto[]).map((r) => mapConv(r, "Agrícola")),
  ];

  INDICE_POSICAO = new Map();
  INDICE_CEST = new Map();
  for (const n of normas) {
    for (const ncm of n.ncms) {
      for (const chave of new Set([ncm.slice(0, 2), ncm.slice(0, 4)])) {
        if (!chave) continue;
        const arr = INDICE_POSICAO.get(chave) || [];
        if (!arr.includes(n)) arr.push(n);
        INDICE_POSICAO.set(chave, arr);
      }
    }
    const c = (n.cest || "").replace(/\D/g, "");
    if (c) {
      const arr = INDICE_CEST.get(c) || [];
      arr.push(n);
      INDICE_CEST.set(c, arr);
    }
  }
  CACHE = normas;
  return normas;
}

export const LegislacaoIndexRepository = {
  todas(): NormaTributaria[] {
    return construir();
  },

  porRegime(regime: RegimeTributario): NormaTributaria[] {
    return construir().filter((n) => n.regime === regime);
  },

  /** busca otimizada por índice de posição/capítulo do NCM */
  candidatasPorNCM(ncm: unknown): NormaTributaria[] {
    construir();
    const d = NcmNormalizer.digitos(ncm);
    if (!d) return [];
    const porPosicao = INDICE_POSICAO!.get(d.slice(0, 4)) || [];
    if (porPosicao.length) return porPosicao;
    return INDICE_POSICAO!.get(d.slice(0, 2)) || [];
  },

  porCEST(cest: unknown): NormaTributaria[] {
    construir();
    const c = String(cest ?? "").replace(/\D/g, "");
    return c ? INDICE_CEST!.get(c) || [] : [];
  },

  /** usado por testes para injetar bases alternativas */
  _substituirBase(normas: NormaTributaria[] | null): void {
    CACHE = normas;
    INDICE_POSICAO = null;
    INDICE_CEST = null;
    if (normas) {
      CACHE = null;
      const original = normas;
      CACHE = original;
      INDICE_POSICAO = new Map();
      INDICE_CEST = new Map();
      for (const n of original) {
        for (const ncm of n.ncms) {
          for (const chave of new Set([ncm.slice(0, 2), ncm.slice(0, 4)])) {
            if (!chave) continue;
            const arr = INDICE_POSICAO.get(chave) || [];
            arr.push(n);
            INDICE_POSICAO.set(chave, arr);
          }
        }
      }
    }
  },
};
