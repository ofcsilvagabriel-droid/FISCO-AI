// Scorer — NCM 50 / Descrição 25 / Segmento 15 / Exceções 10.
// CEST não pontua (é validador).
import type { CandidatoJuridico, DetalheScore, Excecao, PerfilProduto, ResultadoScore } from "../types";
import { NcmMatcher } from "../matchers/NcmMatcher";

export const ScoreCalculator = {
  calcular(perfil: PerfilProduto, candidato: CandidatoJuridico, excecoes: Excecao[]): ResultadoScore {
    const detalhes: DetalheScore[] = [];

    // --- NCM (50) — hierárquico + proximidade de família
    const ncm = NcmMatcher.melhor(perfil.ncm, candidato.norma.ncms);
    let pontosNCM = ncm.pontos;
    if (pontosNCM < 50 && NcmMatcher.mesmaFamilia(perfil.ncm, candidato.norma.ncms[0])) {
      pontosNCM = Math.min(50, pontosNCM + 5); // proximidade tributária de família
    }
    detalhes.push({ componente: "NCM", maximo: 50, obtido: pontosNCM, motivo: ncm.motivo });

    // --- Descrição (25) — similaridade semântica
    const pontosDesc = Math.round(candidato.aderenciaDescricao * 25);
    detalhes.push({
      componente: "DESCRICAO", maximo: 25, obtido: pontosDesc,
      motivo: `Similaridade semântica de ${(candidato.aderenciaDescricao * 100).toFixed(0)}% com a descrição legal.`,
    });

    // --- Segmento (15)
    const pontosSeg = Math.round(candidato.aderenciaSegmento * 15);
    detalhes.push({
      componente: "SEGMENTO", maximo: 15, obtido: pontosSeg,
      motivo: `Segmento do produto "${perfil.segmento}" × segmento da norma "${candidato.norma.segmento || "—"}" (${(candidato.aderenciaSegmento * 100).toFixed(0)}%).`,
    });

    // --- Exceções (10) — ausência de exceção pontua; impeditiva zera tudo
    const impeditivas = excecoes.filter((e) => e.impeditiva);
    const informativas = excecoes.filter((e) => !e.impeditiva);
    const pontosExc = impeditivas.length ? 0 : informativas.length ? 5 : 10;
    detalhes.push({
      componente: "EXCECOES", maximo: 10, obtido: pontosExc,
      motivo: impeditivas.length
        ? `Exceção impeditiva: ${impeditivas[0]!.descricao}`
        : informativas.length
          ? `${informativas.length} nota(s) legal(is) a observar.`
          : "Nenhuma exceção aplicável.",
    });

    const total = impeditivas.length
      ? 0
      : Math.min(100, detalhes.reduce((a, d) => a + d.obtido, 0));

    return { total, detalhes };
  },
};
