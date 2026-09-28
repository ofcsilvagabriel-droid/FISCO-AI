// ============================================================
// DESAMBIGUAÇÃO DE ITENS QUE COMPARTILHAM O MESMO NCM
// ------------------------------------------------------------
// Vários itens do Anexo 1 dividem o MESMO NCM e só se distinguem
// por embalagem, unidade de medida, teor ou finalidade. Exemplo
// real: o NCM 2201 aparece em 11 itens de água mineral (vidro
// descartável, copo plástico, jarra, retornável ≥10L, ≥20L…).
//
// Este módulo deriva, a partir da PRÓPRIA descrição legal:
//   • palavras_obrigatorias → termos que diferenciam este item dos
//     demais itens do mesmo grupo de NCM;
//   • palavras_excludentes  → termos diferenciadores que pertencem
//     a um item IRMÃO e que, se presentes no produto, indicam que
//     ele pertence àquele outro item.
//
// REGRA DE OURO: um termo só vira obrigatório se estiver AUSENTE em
// pelo menos um outro item do mesmo grupo. Termos comuns a todo o
// grupo ("água", "mineral") não diferenciam nada e são ignorados.
//
// Nada é inventado: todos os termos saem do texto legal do item.
// Quando não há termo diferenciador seguro, o item é marcado em
// `revisar` (nenhum termo genérico é forçado).
// ============================================================


function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Remove códigos CEST citados na descrição ("03.024.00"): eles não
    // diferenciam mercadoria alguma e poluiriam a lista com "03", "00", "024".
    .replace(/\d{2}\.\d{3}\.\d{2}/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// Léxico de termos que a legislação usa para separar itens do mesmo NCM.
// Categorias: embalagem, unidade/medida, teor/composição, finalidade, material.
const LEXICO_DIFERENCIADOR = new Set([
  // embalagem / acondicionamento
  "vidro", "plastico", "plastica", "plasticas", "plasticos", "copo", "copos",
  "jarra", "jarras", "garrafa", "garrafas", "garrafao", "lata", "latas",
  "barril", "barris", "sache", "saches", "ampola", "ampolas", "frasco",
  "frascos", "pote", "potes", "tubo", "tubos", "saco", "sacos", "sacola",
  "cartucho", "cartonada", "cartonadas", "tetra", "pet", "aluminio",
  "descartavel", "descartaveis", "retornavel", "retornaveis", "embalagem",
  "embalagens", "granel", "refil", "bombona", "galao", "caixa", "cartucho",
  "blister", "bisnaga", "spray", "aerossol", "aerossois", "demais",
  // unidade / medida / capacidade
  "litro", "litros", "mililitros", "grama", "gramas", "quilograma",
  "quilogramas", "capacidade", "metro", "metros", "polegada", "polegadas",
  "toneladas", "unidades",
  // teor / composição
  "sais", "alcool", "alcoolico", "alcoolica", "alcoolicas", "alcoolicos",
  "gasosa", "gasosas", "gaseificada", "gaseificadas", "acucar", "acucares",
  "ovo", "ovos", "integral", "integrais", "desnatado", "desnatada", "diet",
  "light", "concentrado", "concentrada", "natural", "naturais", "aromatizada",
  "aromatizadas", "saborizada", "instantaneo", "instantanea", "cozida",
  "cozidas", "seca", "secas", "fresca", "frescas", "recheada", "recheadas",
  "adicionadas", "adicionada",
  // finalidade / destinação
  "automotivo", "automotivos", "automotor", "automotores", "veiculo",
  "veiculos", "industrial", "industriais", "agricola", "agricolas",
  "hospitalar", "hospitalares", "domestico", "domestica", "veterinario",
  "veterinaria", "humano", "humana", "infantil", "construcao", "medicinal",
  "farmaceutico", "farmaceutica",
  // material
  "aco", "ferro", "cobre", "madeira", "ceramica", "ceramicas", "porcelana",
  "borracha", "papel", "papelao", "tecido", "algodao", "polietileno", "pvc",
  "acrilico", "granito", "marmore", "vidros", "metal", "metalica", "metalicos",
  // listas de medicamentos (itens 9.x)
  "positiva", "negativa", "neutra",
]);

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "ou", "com", "sem", "para", "por", "em", "a", "o", "as", "os", "um", "uma", "no", "na"]);

function tokensDe(desc) {
  return norm(desc).split(" ").filter((t) => t && !STOP.has(t));
}

/** Tokens candidatos a diferenciador: do léxico OU quantidade numérica. */
function candidatos(desc) {
  return tokensDe(desc).filter((t) => LEXICO_DIFERENCIADOR.has(t) || /^\d{1,4}$/.test(t));
}

function chaveGrupo(ncm) {
  const d = String(ncm ?? "").replace(/\D/g, "");
  return d.slice(0, 4);
}

/**
 * Deriva palavras obrigatórias/excludentes para uma coleção de regras.
 *
 * @param {Array<{id:string, ncm?:string, ncm_patterns?:string[], descricao_legal?:string, descricao?:string}>} regras
 * @returns {Map<string, {palavras_obrigatorias:string[], palavras_excludentes:string[], revisar:string|null}>}
 */
export function derivarDiferenciadores(regras, opcoes = {}) {
  // Termos que o matcher de descrição descarta (TERMOS_NEUTROS do motor).
  // Injetados pelo chamador para evitar import circular — se um termo é
  // ignorado na comparação, exigi-lo como obrigatório reprovaria todo produto.
  const neutros = opcoes.termosIgnorados || new Set();
  const lista = (regras || []).map((r) => ({
    id: r.id,
    grupo: chaveGrupo(r.ncm ?? (r.ncm_patterns || [])[0]),
    desc: r.descricao_legal ?? r.descricao ?? "",
  }));


  const porGrupo = new Map();
  for (const r of lista) {
    if (!r.grupo) continue;
    const arr = porGrupo.get(r.grupo) || [];
    arr.push(r);
    porGrupo.set(r.grupo, arr);
  }

  const saida = new Map();

  for (const [, membros] of porGrupo) {
    // Grupo com um único item: nada a desambiguar.
    if (membros.length < 2) {
      for (const m of membros) {
        saida.set(m.id, { palavras_obrigatorias: [], palavras_excludentes: [], revisar: null });
      }
      continue;
    }

    const tokensPorId = new Map(membros.map((m) => [m.id, new Set(tokensDe(m.desc))]));
    const distintivosPorId = new Map();

    // Frequência do token dentro do grupo: um bom diferenciador aparece na
    // MINORIA dos itens. "gasosa"/"naturais" aparecem em quase todos os itens
    // de água mineral — não separam nada e, se exigidos, reprovariam
    // descrições comerciais legítimas ("Água mineral em jarra 20L").
    const freq = new Map();
    for (const m of membros) {
      for (const t of new Set(candidatos(m.desc))) freq.set(t, (freq.get(t) || 0) + 1);
    }
    const limite = membros.length / 2;

    for (const m of membros) {
      const meus = candidatos(m.desc);
      const distintivos = [...new Set(meus)].filter(
        (t) => (freq.get(t) || 0) < limite && !neutros.has(t),
      );
      distintivosPorId.set(m.id, distintivos);
    }


    for (const m of membros) {
      const obrig = distintivosPorId.get(m.id);
      const meusTokens = tokensPorId.get(m.id);
      // excludentes = diferenciadores dos irmãos que NÃO existem neste item
      const excl = new Set();
      for (const o of membros) {
        if (o.id === m.id) continue;
        for (const t of distintivosPorId.get(o.id)) {
          if (!meusTokens.has(t)) excl.add(t);
        }
      }
      saida.set(m.id, {
        palavras_obrigatorias: obrig,
        palavras_excludentes: [...excl],
        // REVISAR: item divide NCM com outros mas o texto legal não oferece
        // termo diferenciador dentro do léxico — não forçamos termo genérico.
        revisar: obrig.length
          ? null
          : `REVISAR: item ${m.id} compartilha NCM com ${membros.length - 1} outro(s) item(ns) e não possui termo diferenciador claro na descrição legal.`,
      });
    }
  }

  return saida;
}

export const _internos = { norm, tokensDe, candidatos, LEXICO_DIFERENCIADOR };
