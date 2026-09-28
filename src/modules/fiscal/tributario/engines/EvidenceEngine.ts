// ============================================================
// CAMADA 1 — MOTOR DE EVIDÊNCIAS
// Identifica o produto. NÃO consulta legislação.
// Produz um PerfilProduto + lista de evidências ponderadas.
// ============================================================
import { TextNormalizer } from "../normalizers/TextNormalizer";
import { NcmNormalizer } from "../normalizers/NcmNormalizer";
import { SegmentoResolver } from "../resolvers/SegmentoResolver";
import { SEGMENTO_INDEFINIDO } from "../rules/segmentos";
import type { EntradaProduto, Evidencia, PerfilProduto } from "../types";

export const EvidenceEngine = {
  perfilar(entrada: EntradaProduto): PerfilProduto {
    const ncm = NcmNormalizer.digitos(entrada.ncm);
    const descricaoOriginal = String(entrada.descricao ?? "");
    const descricaoNormalizada = TextNormalizer.normalizar(descricaoOriginal);
    const palavrasChave = TextNormalizer.palavrasChave(descricaoOriginal);
    const seg = SegmentoResolver.resolver(descricaoOriginal, ncm);

    const evidencias: Evidencia[] = [];
    const add = (e: Evidencia) => evidencias.push(e);

    if (ncm) {
      add({ tipo: "NCM", valor: ncm, peso: ncm.length >= 8 ? 1 : ncm.length / 8, fonte: "NF-e", detalhe: `Nível ${NcmNormalizer.nivel(ncm)}` });
      add({ tipo: "FAMILIA", valor: NcmNormalizer.familia(ncm), peso: 0.6, fonte: "Derivado do NCM" });
    }
    if (descricaoNormalizada) {
      add({ tipo: "DESCRICAO", valor: descricaoNormalizada, peso: 1, fonte: "NF-e" });
      for (const p of palavrasChave.slice(0, 12)) {
        add({ tipo: "PALAVRA_CHAVE", valor: p, peso: 0.4, fonte: "Normalizador de descrição" });
      }
    }
    if (seg.segmento !== SEGMENTO_INDEFINIDO) {
      add({ tipo: "SEGMENTO", valor: seg.segmento, peso: seg.score, fonte: "SegmentoResolver" });
      if (seg.subsegmento) add({ tipo: "SUBSEGMENTO", valor: seg.subsegmento, peso: seg.score * 0.8, fonte: "SegmentoResolver" });
    }
    const cest = entrada.cest ? String(entrada.cest).replace(/\D/g, "") : "";
    if (cest) add({ tipo: "CEST", valor: cest, peso: 0, fonte: "NF-e", detalhe: "Validador — não pontua." });
    if (entrada.marca) add({ tipo: "MARCA", valor: String(entrada.marca), peso: 0.15, fonte: "Cadastro" });
    if (entrada.fabricante) add({ tipo: "FABRICANTE", valor: String(entrada.fabricante), peso: 0.15, fonte: "Cadastro" });
    if (entrada.gtin) add({ tipo: "GTIN", valor: String(entrada.gtin), peso: 0.2, fonte: "NF-e" });
    if (entrada.unidade) add({ tipo: "UNIDADE", valor: String(entrada.unidade), peso: 0.1, fonte: "NF-e" });
    if (entrada.ufOrigem) add({ tipo: "ORIGEM", valor: String(entrada.ufOrigem).toUpperCase(), peso: 0.5, fonte: "NF-e" });
    if (entrada.ufDestino) add({ tipo: "DESTINO", valor: String(entrada.ufDestino).toUpperCase(), peso: 0.5, fonte: "NF-e" });

    return {
      ncm,
      ncmNivel: NcmNormalizer.nivel(ncm),
      familiaNCM: NcmNormalizer.familia(ncm),
      descricaoOriginal,
      descricaoNormalizada,
      palavrasChave,
      segmento: seg.segmento,
      subsegmento: seg.subsegmento,
      segmentosCandidatos: seg.candidatos,
      cest: cest || null,
      marca: entrada.marca ? String(entrada.marca) : null,
      fabricante: entrada.fabricante ? String(entrada.fabricante) : null,
      gtin: entrada.gtin ? String(entrada.gtin) : null,
      unidade: entrada.unidade ? String(entrada.unidade) : null,
      ufOrigem: entrada.ufOrigem ? String(entrada.ufOrigem).toUpperCase() : null,
      ufDestino: entrada.ufDestino ? String(entrada.ufDestino).toUpperCase() : null,
      evidencias,
    };
  },
};
