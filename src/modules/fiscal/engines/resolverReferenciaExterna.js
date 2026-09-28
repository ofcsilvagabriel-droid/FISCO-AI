// =====================================================================
// RESOLVEDOR POR REFERÊNCIA EXTERNA (Bloco 1.5)
// ---------------------------------------------------------------------
// Recebe um resultado ST_CONFIRMADA_MVA_PENDENTE e tenta resolver o
// sub-item exato usando dado externo ao texto da nota (GTIN/EAN ou
// registro ANVISA). Enquanto a fonte (listasMedicamentos.js) estiver
// vazia, retorna o resultado inalterado — pendente, nunca "chutado".
// =====================================================================
import { consultarListaMedicamentos } from "../data/listasMedicamentos";

export function resolverPorReferenciaExterna(resultado, dadosProduto = {}) {
  if (!resultado || resultado.status !== "ST_CONFIRMADA_MVA_PENDENTE") return resultado;
  if (resultado.modo_desambiguacao !== "REFERENCIA_EXTERNA") return resultado;

  const chave =
    dadosProduto.gtin || dadosProduto.cEAN || dadosProduto.ean || dadosProduto.registroAnvisa;
  if (!chave) return resultado; // sem dado para consultar, mantém pendente

  const registro = consultarListaMedicamentos(chave);
  if (!registro) return resultado; // não cadastrado, mantém pendente

  const escolhido = (resultado.candidatos_mva || []).find(
    (c) => String(c.item_ricms) === String(registro.item_ricms_esperado),
  );
  if (!escolhido) return resultado;

  return {
    ...resultado,
    status: "ST_CONFIRMADA",
    confianca: "ALTA",
    regra: escolhido,
    motivo: `Sub-item resolvido via referência externa (${chave}): ${registro.fonte}.`,
    log: [
      ...(resultado.log || []),
      `[Referência externa] ${chave} → item ${registro.item_ricms_esperado} (${registro.fonte}).`,
    ],
  };
}
