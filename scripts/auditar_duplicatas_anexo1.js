// =====================================================================
// AUDITORIA DE DUPLICATAS — RICMS/BA Anexo 1
// ---------------------------------------------------------------------
// Uso:
//   node scripts/auditar_duplicatas_anexo1.js          → lista duplicatas
//   node scripts/auditar_duplicatas_anexo1.js --fix    → remove duplicatas
//
// Critério de duplicata (o id NÃO serve: as duplicatas têm ids distintos):
//   • mesmo CEST; ou
//   • sem CEST: mesmo item + ncm + descricao.
// Na remoção mantém-se a entrada com texto_original mais completo.
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ARQUIVO = path.resolve("src/modules/fiscal/data/ricmsBaAnexo1.js");

export function chaveDuplicata(r) {
  const cest = String(r.cest ?? "").replace(/\D/g, "");
  if (cest) return `CEST:${cest}`;
  return `ITEM:${r.item ?? ""}|NCM:${r.ncm ?? ""}|DESC:${String(r.descricao ?? "").trim().toLowerCase()}`;
}

export function encontrarDuplicatas(registros) {
  const mapa = new Map();
  for (const r of registros) {
    const k = chaveDuplicata(r);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(r);
  }
  return [...mapa.entries()].filter(([, v]) => v.length > 1);
}

/** Escolhe a entrada a manter: texto_original mais completo. */
export function escolherCanonico(grupo) {
  return [...grupo].sort(
    (a, b) => String(b.texto_original ?? "").length - String(a.texto_original ?? "").length,
  )[0];
}

async function main() {
  const mod = await import(pathToFileURL(ARQUIVO).href);
  const registros = mod.RICMS_BA_ANEXO1;
  const dups = encontrarDuplicatas(registros);

  if (!dups.length) {
    console.log(`OK — ${registros.length} registros, nenhuma duplicata.`);
    return;
  }
  console.log(`${dups.length} grupo(s) duplicado(s) em ${registros.length} registros:`);
  const remover = new Set();
  for (const [k, grupo] of dups) {
    const manter = escolherCanonico(grupo);
    console.log(`\n${k}  (item ${grupo[0].item})`);
    for (const g of grupo) {
      const marca = g.id === manter.id ? "MANTER" : "REMOVER";
      if (g.id !== manter.id) remover.add(g.id);
      console.log(`  [${marca}] ${g.id} — texto_original ${String(g.texto_original ?? "").length} chars`);
    }
  }

  if (!process.argv.includes("--fix")) {
    console.log("\n(execute com --fix para remover)");
    process.exitCode = 1;
    return;
  }

  const limpos = registros.filter((r) => !remover.has(r.id));
  const cabecalho = fs
    .readFileSync(ARQUIVO, "utf8")
    .split("export const RICMS_BA_ANEXO1")[0];
  fs.writeFileSync(
    ARQUIVO,
    `${cabecalho}export const RICMS_BA_ANEXO1 = ${JSON.stringify(limpos, null, 2)};\n`,
  );
  console.log(`\n${remover.size} duplicata(s) removida(s). Restam ${limpos.length} registros.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
