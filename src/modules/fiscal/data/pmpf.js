// =====================================================================
// PMPF — Preço Médio Ponderado a Consumidor Final (pauta fiscal)
// ---------------------------------------------------------------------
// STUB DE DADOS (Bloco 2). A base oficial de PMPF é publicada por UF
// (Bahia: instruções normativas SEFAZ/BA) e por Convênio ICMS 142/18,
// cláusula décima. Enquanto a tabela não for carregada, o array abaixo
// permanece VAZIO e o motor de pauta cai em MVA emitindo aviso visível.
//
// Formato esperado de cada registro:
// {
//   uf: "BA",              // UF de destino a que a pauta se aplica
//   ncm: "22030000",       // NCM (8 dígitos, ou prefixo)
//   cest: "0301100",       // opcional
//   descricao: "Cerveja em lata 350ml",
//   marca: "opcional",
//   embalagem: "opcional",
//   valor: 4.35,           // R$ por unidade
//   unidade: "UN",
//   vigencia_inicio: "2026-01-01",
//   vigencia_fim: null,    // null = vigente
//   fundamento: "IN SEFAZ/BA nº XX/2026",
// }
// =====================================================================

export const PMPF_TABELA = [];

export const PMPF_METADADOS = {
  fonte: "SEFAZ/BA — pauta PMPF (Convênio ICMS 142/18, cláusula décima)",
  atualizado_em: null,
  registros: PMPF_TABELA.length,
  carregada: PMPF_TABELA.length > 0,
};

const digs = (v) => String(v ?? "").replace(/\D/g, "");

function vigente(reg, dataRef) {
  const d = dataRef ? new Date(dataRef) : new Date();
  if (Number.isNaN(d.getTime())) return true;
  const ini = reg.vigencia_inicio ? new Date(reg.vigencia_inicio) : null;
  const fim = reg.vigencia_fim ? new Date(reg.vigencia_fim) : null;
  if (ini && d < ini) return false;
  if (fim && d > fim) return false;
  return true;
}

/**
 * Busca PMPF vigente para o produto.
 * Retorna null quando a base está vazia ou não há correspondência —
 * nesse caso o motor de pauta deve cair em MVA com aviso.
 */
export function buscarPMPF({ ncm, uf = "BA", cest = null, data = null } = {}) {
  if (!PMPF_TABELA.length) return null;
  const n = digs(ncm);
  const c = digs(cest);
  const u = String(uf || "").toUpperCase();
  const candidatos = PMPF_TABELA.filter((r) => {
    if (r.uf && String(r.uf).toUpperCase() !== u) return false;
    if (!vigente(r, data)) return false;
    if (c && digs(r.cest) && digs(r.cest) === c) return true;
    const rn = digs(r.ncm);
    return !!rn && !!n && n.startsWith(rn);
  });
  if (!candidatos.length) return null;
  // maior especificidade de NCM vence
  candidatos.sort((a, b) => digs(b.ncm).length - digs(a.ncm).length);
  const r = candidatos[0];
  return {
    valor: Number(r.valor) || 0,
    unidade: r.unidade || "UN",
    fonte: "PMPF",
    fundamento: r.fundamento || PMPF_METADADOS.fonte,
    registro: r,
  };
}
