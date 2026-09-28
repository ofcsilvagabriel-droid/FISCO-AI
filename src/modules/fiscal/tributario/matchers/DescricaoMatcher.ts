// Matcher de descrição — similaridade semântica (não comparação textual).
// Combina Jaccard de radicais + Dice de trigramas + cobertura de termos legais.
import { TextNormalizer } from "../normalizers/TextNormalizer";

function trigramas(s: string): Set<string> {
  const t = ` ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

export interface ResultadoDescricaoMatch {
  similaridade: number;      // 0-1
  pontos: number;            // 0-25
  termosComuns: string[];
  termosLegaisAusentes: string[];
  compativel: boolean;
  motivo: string;
}

export const DescricaoMatcher = {
  similaridade(descProduto: unknown, descLegal: unknown): number {
    const ra = TextNormalizer.radicais(descProduto);
    const rb = TextNormalizer.radicais(descLegal);
    if (!ra.length || !rb.length) return 0;

    const sa = new Set(ra);
    const sb = new Set(rb);
    let inter = 0;
    for (const x of sb) if (sa.has(x)) inter++;
    const jaccard = inter / new Set([...sa, ...sb]).size;
    // cobertura dos termos legais pelo produto (mais relevante que o inverso)
    const cobertura = inter / sb.size;
    const tri = dice(
      trigramas(TextNormalizer.normalizar(descProduto)),
      trigramas(TextNormalizer.normalizar(descLegal)),
    );
    return Math.min(1, 0.45 * cobertura + 0.3 * jaccard + 0.25 * tri);
  },

  comparar(descProduto: unknown, descLegal: unknown): ResultadoDescricaoMatch {
    const sim = DescricaoMatcher.similaridade(descProduto, descLegal);
    const sa = new Set(TextNormalizer.radicais(descProduto));
    const rb = TextNormalizer.radicais(descLegal);
    const comuns = rb.filter((t) => sa.has(t));
    const ausentes = rb.filter((t) => !sa.has(t));
    const compativel = sim >= 0.25;
    return {
      similaridade: sim,
      pontos: Math.round(sim * 25),
      termosComuns: comuns,
      termosLegaisAusentes: ausentes.slice(0, 8),
      compativel,
      motivo: compativel
        ? `Aderência semântica de ${(sim * 100).toFixed(0)}% com a descrição legal (${comuns.length}/${rb.length} termos).`
        : `Aderência semântica insuficiente (${(sim * 100).toFixed(0)}%).`,
    };
  },
};
