// Matcher de NCM — proximidade tributária hierárquica.
// Pontuação da camada de score: 2 díg = 5, 4 = 15, 6 = 30, 8 = 50.
import { NcmNormalizer } from "../normalizers/NcmNormalizer";
import type { NivelNCM } from "../types";

const PONTOS_POR_NIVEL: Record<NivelNCM, number> = {
  NENHUM: 0,
  CAPITULO: 5,
  POSICAO: 15,
  SUBPOSICAO: 30,
  ITEM: 50,
};

export interface ResultadoNcmMatch {
  digitosCoincidentes: number;
  nivel: NivelNCM;
  pontos: number;           // 0-50
  conflito: { posicao: number; produto: string | null; norma: string } | null;
  compativel: boolean;      // todos os dígitos declarados pela norma batem
  proximidade: number;      // 0-1 — proximidade tributária de família
  motivo: string;
}

function nivelPorDigitos(n: number): NivelNCM {
  if (n >= 8) return "ITEM";
  if (n >= 6) return "SUBPOSICAO";
  if (n >= 4) return "POSICAO";
  if (n >= 2) return "CAPITULO";
  return "NENHUM";
}

export const NcmMatcher = {
  comparar(ncmProduto: unknown, ncmNorma: unknown): ResultadoNcmMatch {
    const p = NcmNormalizer.digitos(ncmProduto);
    const r = NcmNormalizer.digitos(ncmNorma);

    if (!p || !r) {
      return {
        digitosCoincidentes: 0, nivel: "NENHUM", pontos: 0, conflito: null,
        compativel: false, proximidade: 0,
        motivo: !p ? "NCM do produto ausente." : "Norma sem NCM declarado.",
      };
    }

    let coincidentes = 0;
    let conflito: ResultadoNcmMatch["conflito"] = null;
    const limite = Math.min(p.length, r.length);
    for (let i = 0; i < limite; i++) {
      if (p[i] === r[i]) coincidentes++;
      else {
        conflito = { posicao: i + 1, produto: p[i] ?? null, norma: r[i]! };
        break;
      }
    }

    // apenas níveis fechados (2/4/6/8) valem pontos
    const nivelDigitos = coincidentes >= 8 ? 8 : coincidentes >= 6 ? 6 : coincidentes >= 4 ? 4 : coincidentes >= 2 ? 2 : 0;
    const nivel = nivelPorDigitos(nivelDigitos);
    // a norma nunca pode valer mais do que os dígitos que ela própria declara
    const tetoNorma = PONTOS_POR_NIVEL[nivelPorDigitos(r.length >= 8 ? 8 : r.length >= 6 ? 6 : r.length >= 4 ? 4 : r.length >= 2 ? 2 : 0)];
    const pontos = Math.min(PONTOS_POR_NIVEL[nivel], tetoNorma);

    const compativel = !conflito && coincidentes >= Math.min(r.length, 8);
    const proximidade = Math.min(1, coincidentes / Math.max(r.length, 1));

    return {
      digitosCoincidentes: coincidentes,
      nivel,
      pontos,
      conflito,
      compativel,
      proximidade,
      motivo: compativel
        ? `NCM aderente até o nível ${nivel} (${coincidentes} dígitos).`
        : conflito
          ? `Divergência no ${conflito.posicao}º dígito (produto "${conflito.produto ?? "—"}" × norma "${conflito.norma}").`
          : `Aderência parcial de ${coincidentes} dígitos.`,
    };
  },

  /** melhor aderência entre as alternativas de NCM de uma norma */
  melhor(ncmProduto: unknown, ncmsNorma: string[]): ResultadoNcmMatch {
    let melhor: ResultadoNcmMatch | null = null;
    for (const alt of ncmsNorma.length ? ncmsNorma : [""]) {
      const m = NcmMatcher.comparar(ncmProduto, alt);
      if (!melhor) melhor = m;
      else if (
        (m.compativel && !melhor.compativel) ||
        (m.compativel === melhor.compativel && m.digitosCoincidentes > melhor.digitosCoincidentes)
      ) melhor = m;
    }
    return melhor!;
  },

  /** mesma família tributária (posição 4 díg.) */
  mesmaFamilia(a: unknown, b: unknown): boolean {
    const fa = NcmNormalizer.familia(a);
    const fb = NcmNormalizer.familia(b);
    return !!fa && fa === fb;
  },
};
