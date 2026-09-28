// ============================================================
// CAMADA 2 — MOTOR JURÍDICO
// NÃO utiliza score. Consulta exclusivamente a base estruturada
// de legislação e devolve os dispositivos aderentes ao produto.
// ============================================================
import { LegislacaoIndexRepository } from "../repositories/LegislacaoIndexRepository";
import { NcmMatcher } from "../matchers/NcmMatcher";
import { DescricaoMatcher } from "../matchers/DescricaoMatcher";
import { SegmentoResolver } from "../resolvers/SegmentoResolver";
import { CestValidator } from "../validators/CestValidator";
import type {
  CandidatoJuridico,
  NormaTributaria,
  PerfilProduto,
  RegimeTributario,
  ResultadoJuridico,
} from "../types";

export const LegalEngine = {
  consultar(perfil: PerfilProduto, base?: NormaTributaria[]): ResultadoJuridico {
    const universo = base ?? LegislacaoIndexRepository.candidatasPorNCM(perfil.ncm);
    const candidatos: CandidatoJuridico[] = [];
    const descartados: ResultadoJuridico["descartados"] = [];

    for (const norma of universo) {
      const ncm = NcmMatcher.melhor(perfil.ncm, norma.ncms);
      if (ncm.digitosCoincidentes < 4) {
        descartados.push({ norma, motivo: ncm.motivo });
        continue;
      }
      const desc = DescricaoMatcher.comparar(perfil.descricaoOriginal, norma.descricaoLegal);
      candidatos.push({
        norma,
        ncmNivel: ncm.nivel,
        digitosCoincidentes: ncm.digitosCoincidentes,
        aderenciaDescricao: desc.similaridade,
        aderenciaSegmento: SegmentoResolver.aderencia(perfil.segmento, norma.segmento),
        cestConfere: CestValidator.conferir(perfil.cest, norma.cest),
      });
    }

    // ordenação jurídica: especificidade do NCM → aderência da descrição
    candidatos.sort((a, b) =>
      b.digitosCoincidentes - a.digitosCoincidentes ||
      b.aderenciaDescricao - a.aderenciaDescricao);

    const regimes = [...new Set(candidatos.map((c) => c.norma.regime))] as RegimeTributario[];
    return { candidatos, descartados, regimesEncontrados: regimes };
  },

  /** consulta direta por CEST — usada como validação, nunca como requisito */
  porCEST(cest: unknown): NormaTributaria[] {
    return LegislacaoIndexRepository.porCEST(cest);
  },
};
