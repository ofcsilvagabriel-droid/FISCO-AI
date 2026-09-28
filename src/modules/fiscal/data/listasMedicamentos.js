// =====================================================================
// LISTAS DE MEDICAMENTOS — PMC (Preço Máximo ao Consumidor / CMED)
// ---------------------------------------------------------------------
// STUB DE DADOS (Bloco 2). O PMC de medicamentos decorre da lista CMED
// (Câmara de Regulação do Mercado de Medicamentos) e é a base de cálculo
// da ST do segmento farmacêutico (Convênio ICMS 234/17 c/c 142/18).
// Enquanto a lista não for carregada, o array abaixo permanece VAZIO e o
// motor de pauta cai em MVA emitindo aviso visível.
//
// Formato esperado de cada registro:
// {
//   ean: "7891234567890",
//   ncm: "30049099",
//   descricao: "DIPIRONA 500MG 20CP",
//   laboratorio: "opcional",
//   lista: "POSITIVA" | "NEGATIVA" | "NEUTRA",
//   pmc: 18.90,              // R$ por embalagem, para a UF/alíquota
//   uf: "BA",
//   aliquota_referencia: 20.5,
//   vigencia_inicio: "2026-01-01",
//   vigencia_fim: null,
//   fundamento: "Lista CMED — Convênio ICMS 234/17",
// }
// =====================================================================

export const LISTA_MEDICAMENTOS = [];

// Cadastro de referência externa usado para desambiguar os sub-itens 9.1–9.5
// do Anexo 1 (referência/genérico/similar × lista positiva/negativa/neutra).
// TODO: alimentar a partir da lista CMED/ANVISA real. Deve permanecer VAZIO
// enquanto não houver fonte oficial — nunca preencher com exemplos.
// Formato: { chave: "<GTIN/EAN ou registro ANVISA>", item_ricms_esperado: "9.2.0",
//            lista: "POSITIVA", classe: "GENERICO", fonte: "CMED 2026-01" }
export const REFERENCIA_MEDICAMENTOS = [];

const _REFERENCIA_TESTE = new Map();
/** Injeta registros de referência externa (uso exclusivo de testes). */
export function _registrarReferenciaParaTeste(registros) {
  _REFERENCIA_TESTE.clear();
  for (const r of registros || []) _REFERENCIA_TESTE.set(String(r.chave).replace(/\s/g, ""), r);
}

/**
 * Consulta o cadastro externo por GTIN/EAN ou registro ANVISA.
 * Retorna null enquanto a fonte não estiver alimentada.
 */
export function consultarListaMedicamentos(chave) {
  const k = String(chave ?? "").replace(/\s/g, "");
  if (!k) return null;
  return (
    _REFERENCIA_TESTE.get(k) ||
    REFERENCIA_MEDICAMENTOS.find((r) => String(r.chave).replace(/\s/g, "") === k) ||
    null
  );
}

export const LISTA_MEDICAMENTOS_METADADOS = {
  fonte: "CMED/ANVISA — PMC de medicamentos (Convênio ICMS 234/17)",
  atualizado_em: null,
  registros: LISTA_MEDICAMENTOS.length,
  carregada: LISTA_MEDICAMENTOS.length > 0,
  referencias: REFERENCIA_MEDICAMENTOS.length,
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

/** NCMs do capítulo 30 típicos de medicamentos sujeitos a PMC. */
export function ehMedicamento(ncm) {
  const n = digs(ncm);
  return n.startsWith("3003") || n.startsWith("3004");
}

/**
 * Busca PMC do medicamento por EAN (prioritário) ou NCM.
 * Retorna null quando a lista está vazia ou sem correspondência.
 */
export function buscarPMCMedicamento({ ean = null, ncm = null, uf = "BA", data = null } = {}) {
  if (!LISTA_MEDICAMENTOS.length) return null;
  const e = digs(ean);
  const n = digs(ncm);
  const u = String(uf || "").toUpperCase();
  const aplicavel = (r) =>
    (!r.uf || String(r.uf).toUpperCase() === u) && vigente(r, data);

  let reg = e ? LISTA_MEDICAMENTOS.find((r) => digs(r.ean) === e && aplicavel(r)) : null;
  if (!reg && n) {
    const cands = LISTA_MEDICAMENTOS.filter(
      (r) => aplicavel(r) && !!digs(r.ncm) && n.startsWith(digs(r.ncm)),
    );
    cands.sort((a, b) => digs(b.ncm).length - digs(a.ncm).length);
    reg = cands[0] || null;
  }
  if (!reg) return null;
  return {
    valor: Number(reg.pmc) || 0,
    unidade: "UN",
    fonte: "PMC_CMED",
    lista: reg.lista || null,
    fundamento: reg.fundamento || LISTA_MEDICAMENTOS_METADADOS.fonte,
    registro: reg,
  };
}
