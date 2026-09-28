// ============================================================
// CAMADA 3 — CONSOLIDADOR TRIBUTÁRIO
// Recebe Motor de Evidências + Motor Jurídico e produz o
// CONTEXTO TRIBUTÁRIO — objeto único consumido pelo Motor de
// Cálculo (que permanece inalterado) e, futuramente, pelo
// Motor de Benefícios.
// ============================================================
import { ScoreCalculator } from "../scorers/ScoreCalculator";
import { ConfiancaScorer } from "../scorers/ConfiancaScorer";
import { ExcecaoPolicy } from "../policies/ExcecaoPolicy";
import { ClassificacaoPolicy } from "../policies/ClassificacaoPolicy";
import { AliquotasRepository } from "../../domain/repositories/AliquotasRepository";
import type {
  ContextoRegime,
  ContextoTributario,
  Excecao,
  PerfilProduto,
  RegimeStrategy,
  ResultadoJuridico,
} from "../types";

function numeroOuNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const TaxConsolidator = {
  consolidar(
    perfil: PerfilProduto,
    juridico: ResultadoJuridico,
    strategies: RegimeStrategy[],
    extras: { aliquotaDestacada?: number | null; origemImportada?: boolean } = {},
  ): ContextoTributario {
    const trilha: string[] = [];
    trilha.push(`[EVIDÊNCIAS] NCM ${perfil.ncm || "—"} (${perfil.ncmNivel}), segmento ${perfil.segmento}/${perfil.subsegmento}.`);
    trilha.push(`[EVIDÊNCIAS] ${perfil.palavrasChave.length} palavra(s)-chave: ${perfil.palavrasChave.slice(0, 8).join(", ") || "—"}.`);
    trilha.push(`[JURÍDICO] ${juridico.candidatos.length} dispositivo(s) aderente(s); ${juridico.descartados.length} descartado(s) por NCM.`);

    // --- exceções (prioridade máxima) por candidato
    const excecoesPorCandidato = juridico.candidatos.map((c) => ExcecaoPolicy.avaliar(perfil, c));

    // --- escolhe o dispositivo principal: sem exceção impeditiva e maior score
    let melhorIdx = -1;
    let melhorScore = -1;
    const scores = juridico.candidatos.map((c, i) => ScoreCalculator.calcular(perfil, c, excecoesPorCandidato[i]!));
    scores.forEach((s, i) => {
      const bloqueado = ExcecaoPolicy.possuiImpeditiva(excecoesPorCandidato[i]!);
      if (!bloqueado && s.total > melhorScore) { melhorScore = s.total; melhorIdx = i; }
    });

    const bloqueadosTodos = juridico.candidatos.length > 0 && melhorIdx === -1;
    if (bloqueadosTodos) {
      trilha.push("[EXCEÇÕES] Todos os dispositivos aderentes foram bloqueados por exceção impeditiva.");
    }

    const candidato = melhorIdx >= 0 ? juridico.candidatos[melhorIdx]! : null;
    const excecoes: Excecao[] = melhorIdx >= 0
      ? excecoesPorCandidato[melhorIdx]!
      : excecoesPorCandidato.flat();
    const score = melhorIdx >= 0 ? scores[melhorIdx]! : { total: 0, detalhes: [] };
    const confianca = ConfiancaScorer.avaliar(perfil, candidato, excecoes);

    if (candidato) {
      trilha.push(`[JURÍDICO] Dispositivo principal: ${candidato.norma.id} — ${candidato.norma.fundamento}.`);
      trilha.push(`[SCORE] ${score.total}/100 · [CONFIANÇA] ${confianca.indice}%.`);
    }

    // --- regimes via strategies (somente sobre candidatos não bloqueados)
    const juridicoLimpo: ResultadoJuridico = {
      ...juridico,
      candidatos: juridico.candidatos.filter((_, i) => !ExcecaoPolicy.possuiImpeditiva(excecoesPorCandidato[i]!)),
    };
    const regimes: ContextoRegime[] = [];
    for (const st of strategies) {
      const r = st.detectar(perfil, juridicoLimpo);
      if (r) regimes.push(r);
    }

    const valorDecisorio = ClassificacaoPolicy.valorDecisorio(score.total, confianca.indice);
    const faixa = ClassificacaoPolicy.faixa(valorDecisorio);
    trilha.push(`[CLASSIFICAÇÃO] ${ClassificacaoPolicy.descrever(faixa)}`);

    const classificavel = ClassificacaoPolicy.classificavel(faixa);
    const possuiST = classificavel && regimes.some((r) => r.regime === "ICMS_ST" && r.aplicavel);
    const possuiAntecipacao = regimes.some((r) => r.regime === "ANTECIPACAO" && r.aplicavel) && !possuiST;

    const norma = candidato?.norma ?? null;
    const secundarias = juridicoLimpo.candidatos
      .filter((c) => c.norma.id !== norma?.id)
      .slice(0, 5)
      .map((c) => c.norma);

    const interna = perfil.ufDestino ? numeroOuNull(AliquotasRepository.interna(perfil.ufDestino)) : null;
    const interestadual = perfil.ufOrigem && perfil.ufDestino
      ? numeroOuNull(AliquotasRepository.interestadual(perfil.ufOrigem, perfil.ufDestino, !!extras.origemImportada))
      : null;

    return {
      ncm: perfil.ncm,
      segmento: perfil.segmento,
      subsegmento: perfil.subsegmento,
      descricaoNormalizada: perfil.descricaoNormalizada,
      palavrasChave: perfil.palavrasChave,
      cest: perfil.cest,

      score: score.total,
      scoreDetalhes: score.detalhes,
      confianca: confianca.indice,
      confiancaDetalhes: confianca,
      faixa,
      classificavelAutomaticamente: classificavel,

      possuiST,
      possuiAntecipacao,
      regimes,

      normaPrincipal: norma,
      normasSecundarias: secundarias,
      protocolos: norma?.protocolos ?? [],
      convenios: norma?.convenios ?? [],
      fundamentos: [norma?.fundamento, ...secundarias.map((n) => n.fundamento)].filter(Boolean) as string[],
      beneficios: norma?.beneficios ?? [],
      observacoes: [...(norma?.notas ?? []), ...(norma?.observacoes ?? [])],
      excecoes,

      aliquotas: {
        interna,
        interestadual,
        destacada: numeroOuNull(extras.aliquotaDestacada),
      },
      mvas: {
        original: norma?.mvaOriginal ?? null,
        ajustada4: norma?.mvaAjustada4 ?? null,
        ajustada7: norma?.mvaAjustada7 ?? null,
        ajustada12: norma?.mvaAjustada12 ?? null,
      },
      reducoes: norma?.reducoes ?? [],
      situacaoTributaria: possuiST
        ? "SUJEITO_A_ST"
        : possuiAntecipacao
          ? "SUJEITO_A_ANTECIPACAO"
          : bloqueadosTodos
            ? "BLOQUEADO_POR_EXCECAO"
            : candidato
              ? faixa === "NAO_CLASSIFICAR" ? "NAO_CLASSIFICADO" : "PENDENTE_REVISAO"
              : "SEM_ENQUADRAMENTO",

      evidencias: perfil.evidencias,
      trilha,
    };
  },
};
