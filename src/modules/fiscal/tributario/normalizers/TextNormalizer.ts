// Normalizer de texto — base de toda a análise semântica.
// Sem regra tributária: apenas linguagem.

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "ou", "com", "sem", "para", "por", "em",
  "a", "o", "as", "os", "um", "uma", "no", "na", "nos", "nas", "ao", "aos",
  "the", "of", "and", "tipo", "ref", "cod", "codigo", "item", "prod", "produto",
]);

// termos comerciais neutros (não descrevem a mercadoria)
const NEUTROS = new Set([
  "embalagem", "pacote", "pct", "unid", "unidade", "und", "cx", "caixa", "pc",
  "pcs", "fardo", "display", "sortido", "diversos", "novo", "nova", "linha",
]);

export const TextNormalizer = {
  /** minúsculo, sem acentos, sem pontuação, espaços colapsados */
  normalizar(valor: unknown): string {
    return String(valor ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s.,/-]/g, " ")
      .replace(/[.,/-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  /** tokens significativos (>=3 chars, sem stopwords) */
  tokens(valor: unknown): string[] {
    return TextNormalizer.normalizar(valor)
      .split(" ")
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  },

  /** tokens descritivos: remove ruído comercial, preserva medidas */
  palavrasChave(valor: unknown): string[] {
    const vistos = new Set<string>();
    const out: string[] = [];
    for (const t of TextNormalizer.tokens(valor)) {
      if (NEUTROS.has(t)) continue;
      if (/^\d+$/.test(t) && t.length < 3) continue;
      if (vistos.has(t)) continue;
      vistos.add(t);
      out.push(t);
    }
    return out;
  },

  /** radical simples pt-BR (plural / sufixos comuns) */
  radical(token: string): string {
    let t = token;
    t = t.replace(/(oes|aes|ais|eis|ois|uis|ns)$/, "");
    t = t.replace(/s$/, "");
    t = t.replace(/(inho|inha|zinho|zinha|mente)$/, "");
    return t.length >= 3 ? t : token;
  },

  radicais(valor: unknown): string[] {
    return TextNormalizer.palavrasChave(valor).map(TextNormalizer.radical);
  },
};
