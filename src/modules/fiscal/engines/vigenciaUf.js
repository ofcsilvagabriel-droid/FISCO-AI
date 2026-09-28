// ============================================================
// MÓDULO COMPARTILHADO — VIGÊNCIA TEMPORAL E UFs SIGNATÁRIAS
// ------------------------------------------------------------
// Fonte única para dois problemas que antes estavam duplicados
// (inferirUfs em motorClassificacaoST.js e extrairUFs em
// tributario/repositories/LegislacaoIndexRepository.ts):
//
//   1. extrairUfsDeTexto(texto)   → lê o bloco "Todos, exceto XX, YY e ZZ"
//      de UM trecho específico (nunca do texto inteiro do item, que pode
//      conter a redação anterior com outra lista de UFs).
//
//   2. parseVersoesTexto(texto)   → separa o texto_original do item em
//      VERSÕES temporais distintas, a partir dos marcadores oficiais do
//      Anexo 1:
//         "… efeitos a partir de DD/MM/AA …"
//         "Redação anterior, efeitos até DD/MM/AA. “<texto antigo>”"
//      Cada versão carrega a sua própria janela [vigencia_inicio,
//      vigencia_fim) e o seu próprio conjunto de UFs/MVA, extraídos
//      APENAS do seu trecho.
//
// Convenção de janela: half-open [inicio, fim).
//   • inicio === null → sem limite inferior conhecido.
//   • fim    === null → ainda vigente.
// ============================================================

/** Converte "01/07/26" em Date UTC. Aceita AA (2 díg.) e AAAA. */
export function parseDataBR(s) {
  const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const ano = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const d = new Date(Date.UTC(ano, Number(mm) - 1, Number(dd)));
  return isNaN(d.getTime()) ? null : d;
}

/** Normaliza qualquer entrada de data (Date | ISO | DD/MM/AA) para Date UTC. */
export function normalizarData(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  return parseDataBR(s);
}

function somarDias(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

/** Verifica se `data` está dentro da janela half-open [inicio, fim). */
export function vigenteEm(versao, data) {
  const d = normalizarData(data) || new Date();
  const ini = normalizarData(versao?.vigencia_inicio);
  const fim = normalizarData(versao?.vigencia_fim);
  if (ini && d < ini) return false;
  if (fim && d >= fim) return false;
  return true;
}

/**
 * Lê a lista de UFs signatárias de UM trecho de texto.
 * Suporta "Todos, exceto MG, RO, RR, RS, SC e SP" e "Todos".
 */
export function extrairUfsDeTexto(texto) {
  const t = String(texto || "");
  const m = t.match(/Todos,?\s*exceto\s+((?:[A-Z]{2}(?:\s*(?:,|e)\s*)?)+)/);
  if (m) {
    const ufs = m[1].match(/\b[A-Z]{2}\b/g) || [];
    return { modo: "TODOS_EXCETO", ufs: [...new Set(ufs)] };
  }
  if (/\bTodos\b/.test(t)) return { modo: "TODOS", ufs: [] };
  return { modo: "TODOS", ufs: [] };
}

/** Extrai as MVAs ajustadas presentes em um trecho específico. */
export function extrairMvasDeTexto(texto) {
  const t = String(texto || "");
  const pega = (aliq) => {
    const re = new RegExp(`([\\d.,]+)\\s*%\\s*\\(\\s*Al[ií]q\\.?\\s*${aliq}\\s*%`, "i");
    const m = t.match(re);
    return m ? m[1] : null;
  };
  return {
    mva_ajustada_4: pega(4),
    mva_ajustada_7: pega(7),
    mva_ajustada_12: pega(12),
  };
}

/**
 * Separa o texto_original de um item do Anexo 1 em versões temporais.
 *
 * Estrutura reconhecida (padrão editorial do RICMS/BA):
 *   <texto vigente> [Nota: … efeitos a partir de DD/MM/AA …]
 *   Redação anterior, efeitos até DD/MM/AA. “<texto anterior>”
 *   [Redação anterior, efeitos até DD/MM/AA. “<texto mais antigo>”] …
 *
 * @returns {Array<{trecho:string, vigencia_inicio:Date|null,
 *                  vigencia_fim:Date|null, atual:boolean}>}
 *          ordenado da versão mais recente para a mais antiga.
 */
export function parseVersoesTexto(texto) {
  const t = String(texto || "");
  if (!t.trim()) {
    return [{ trecho: "", vigencia_inicio: null, vigencia_fim: null, atual: true }];
  }

  const reAnterior = /Reda[çc][ãa]o\s+anterior,?\s*(?:com\s+)?efeitos\s+at[ée]\s+(\d{2}\/\d{2}\/\d{2,4})/gi;
  const marcos = [];
  let m;
  while ((m = reAnterior.exec(t))) {
    marcos.push({ index: m.index, fimStr: m[1], after: reAnterior.lastIndex });
  }

  // Sem redação anterior → item com versão única, sem limites conhecidos.
  if (!marcos.length) {
    return [{ trecho: t, vigencia_inicio: null, vigencia_fim: null, atual: true }];
  }

  // Versão vigente = tudo antes do primeiro marcador de redação anterior.
  const trechoAtual = t.slice(0, marcos[0].index);
  // "efeitos a partir de DD/MM/AA" da Nota que justifica a redação atual.
  const partirs = [...trechoAtual.matchAll(/efeitos\s+a\s+partir\s+de\s+(\d{2}\/\d{2}\/\d{2,4})/gi)];
  const inicioAtual = partirs.length
    ? parseDataBR(partirs[partirs.length - 1][1])
    : (() => {
        // Sem "a partir de" explícito: o início é o dia seguinte ao fim da
        // redação anterior imediatamente precedente.
        const f = parseDataBR(marcos[0].fimStr);
        return f ? somarDias(f, 1) : null;
      })();

  const versoes = [
    { trecho: trechoAtual, vigencia_inicio: inicioAtual, vigencia_fim: null, atual: true },
  ];

  // Cada redação anterior: trecho vai do fim do marcador até o próximo marcador.
  for (let i = 0; i < marcos.length; i++) {
    const ini = marcos[i].after;
    const fimIdx = i + 1 < marcos.length ? marcos[i + 1].index : t.length;
    const dataFim = parseDataBR(marcos[i].fimStr);
    versoes.push({
      trecho: t.slice(ini, fimIdx),
      // "efeitos até DD/MM/AA" é inclusivo → janela half-open termina no dia seguinte.
      vigencia_fim: dataFim ? somarDias(dataFim, 1) : null,
      vigencia_inicio: null, // encadeado abaixo
      atual: false,
    });
  }

  // Encadeia: o início de uma versão antiga é o fim da versão ainda mais antiga.
  for (let i = 1; i < versoes.length; i++) {
    const maisAntiga = versoes[i + 1];
    versoes[i].vigencia_inicio = maisAntiga ? maisAntiga.vigencia_fim : null;
  }

  return versoes;
}
