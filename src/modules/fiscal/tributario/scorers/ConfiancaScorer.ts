// Índice de confiança — independente do score. Avalia COERÊNCIA
// entre NCM, descrição, segmento e legislação encontrada.
import type { CandidatoJuridico, Excecao, PerfilProduto, ResultadoConfianca } from "../types";

export const ConfiancaScorer = {
  avaliar(perfil: PerfilProduto, candidato: CandidatoJuridico | null, excecoes: Excecao[]): ResultadoConfianca {
    const coerencias: string[] = [];
    const incoerencias: string[] = [];

    if (!candidato) {
      return { indice: 0, coerencias, incoerencias: ["Nenhum dispositivo legal aderente localizado."] };
    }

    let indice = 100;

    // NCM
    if (candidato.digitosCoincidentes >= 8) coerencias.push("NCM aderente em 8 dígitos.");
    else if (candidato.digitosCoincidentes >= 6) { coerencias.push("NCM aderente em 6 dígitos."); indice -= 10; }
    else if (candidato.digitosCoincidentes >= 4) { coerencias.push("NCM aderente em 4 dígitos."); indice -= 25; }
    else { incoerencias.push("NCM aderente apenas em nível de capítulo."); indice -= 40; }

    // Descrição
    if (candidato.aderenciaDescricao >= 0.5) coerencias.push("Descrição compatível com a descrição legal.");
    else if (candidato.aderenciaDescricao >= 0.25) { coerencias.push("Descrição parcialmente compatível."); indice -= 20; }
    else { incoerencias.push("Descrição incompatível com a descrição legal."); indice -= 40; }

    // Segmento
    if (candidato.aderenciaSegmento >= 0.75) coerencias.push("Segmento do produto coerente com o segmento da norma.");
    else if (candidato.aderenciaSegmento >= 0.5) indice -= 10;
    else { incoerencias.push("Segmento do produto incompatível com o segmento da norma."); indice -= 50; }

    // CEST (validador)
    if (candidato.cestConfere === true) coerencias.push("CEST informado confirma o enquadramento.");
    else if (candidato.cestConfere === false) { incoerencias.push("CEST informado diverge do CEST da norma."); indice -= 20; }

    // Exceções
    if (excecoes.some((e) => e.impeditiva)) {
      incoerencias.push("Exceção legal impeditiva identificada.");
      indice = 0;
    } else if (excecoes.length) {
      indice -= 5;
    }

    return { indice: Math.max(0, Math.min(100, indice)), coerencias, incoerencias };
  },
};
