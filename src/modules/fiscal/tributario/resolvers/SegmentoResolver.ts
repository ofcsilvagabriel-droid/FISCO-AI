// Resolver de segmento/subsegmento a partir do perfil textual + NCM.
import { SEGMENTOS, SEGMENTO_INDEFINIDO } from "../rules/segmentos";
import { TextNormalizer } from "../normalizers/TextNormalizer";
import { NcmNormalizer } from "../normalizers/NcmNormalizer";

export interface ResultadoSegmento {
  segmento: string;
  subsegmento: string;
  score: number;                 // 0-1 de confiança da segmentação
  candidatos: Array<{ segmento: string; score: number }>;
}

export const SegmentoResolver = {
  resolver(descricao: unknown, ncm: unknown): ResultadoSegmento {
    const radicais = new Set(TextNormalizer.radicais(descricao));
    const capitulo = NcmNormalizer.capitulo(ncm);

    const pontuados = SEGMENTOS.map((def) => {
      let hits = 0;
      let sub = "";
      let subHits = 0;

      for (const p of def.palavras) {
        if (radicais.has(TextNormalizer.radical(p))) hits++;
      }
      for (const [nome, palavras] of Object.entries(def.subsegmentos)) {
        let h = 0;
        for (const p of palavras) if (radicais.has(TextNormalizer.radical(p))) h++;
        if (h > subHits) { subHits = h; sub = nome; }
        hits += h;
      }

      const capOK = capitulo && def.capitulosNCM.includes(capitulo);
      // texto domina; NCM apenas reforça (evita segmentar só por capítulo)
      const score = Math.min(1, hits * 0.34 + (capOK ? 0.2 : 0));
      return { segmento: def.segmento, subsegmento: sub, score, hits };
    })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score || b.hits - a.hits);

    const melhor = pontuados[0];
    if (!melhor || melhor.hits === 0) {
      return {
        segmento: SEGMENTO_INDEFINIDO,
        subsegmento: "",
        score: 0,
        candidatos: pontuados.map(({ segmento, score }) => ({ segmento, score })),
      };
    }

    return {
      segmento: melhor.segmento,
      subsegmento: melhor.subsegmento || "GERAL",
      score: melhor.score,
      candidatos: pontuados.slice(0, 5).map(({ segmento, score }) => ({ segmento, score })),
    };
  },

  /** aderência entre o segmento do produto e o segmento textual da norma */
  aderencia(segmentoProduto: string, segmentoNorma: unknown): number {
    if (!segmentoProduto || segmentoProduto === SEGMENTO_INDEFINIDO) return 0.5; // neutro
    const alvo = TextNormalizer.normalizar(segmentoNorma);
    if (!alvo) return 0.5;
    const def = SEGMENTOS.find((s) => s.segmento === segmentoProduto);
    if (!def) return 0.5;
    for (const alias of def.aliasLegais) {
      const a = TextNormalizer.normalizar(alias);
      if (a && (alvo.includes(a) || a.includes(alvo))) return 1;
    }
    const radicaisNorma = new Set(TextNormalizer.radicais(segmentoNorma));
    const hits = def.palavras.filter((p) => radicaisNorma.has(TextNormalizer.radical(p))).length;
    if (hits > 0) return 0.75;
    return 0;
  },
};
