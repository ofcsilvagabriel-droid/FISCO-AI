// Camada exclusiva de exceções legais — prioridade máxima.
// Uma exceção impeditiva bloqueia a classificação mesmo com score alto.
import { TextNormalizer } from "../normalizers/TextNormalizer";
import type { CandidatoJuridico, Excecao, PerfilProduto } from "../types";

/** termos que, presentes na descrição do produto, negam a norma */
const NEGADORES_POR_TERMO: Array<{ quando: RegExp; termo: RegExp; motivo: string }> = [
  { quando: /uso automotivo|veicul|automotor/i, termo: /\b(brinquedo|miniatura)\b/i, motivo: "Finalidade incompatível: item lúdico não é peça automotiva." },
  { quando: /medicament/i, termo: /\b(veterinari|animal)\b/i, motivo: "Finalidade incompatível: uso veterinário fora do item de uso humano." },
];

function extrairExcetoTermos(texto: string): string[] {
  const out: string[] = [];
  const re = /exceto\s+([^.;)]{3,120})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) out.push(m[1]!);
  return out;
}

export const ExcecaoPolicy = {
  avaliar(perfil: PerfilProduto, candidato: CandidatoJuridico): Excecao[] {
    const excecoes: Excecao[] = [];
    const norma = candidato.norma;
    const radicaisProduto = new Set(TextNormalizer.radicais(perfil.descricaoOriginal));

    // 1) exceções textuais declaradas na própria norma ("exceto ...")
    for (const trecho of norma.excecoes) {
      for (const excluido of extrairExcetoTermos(trecho)) {
        const radicais = TextNormalizer.radicais(excluido);
        const bateu = radicais.length > 0 && radicais.every((r) => radicaisProduto.has(r));
        if (bateu) {
          excecoes.push({
            tipo: "PRODUTO_EXCLUIDO",
            impeditiva: true,
            descricao: `Produto expressamente excluído: "${excluido.trim()}".`,
            fundamento: norma.fundamento,
            normaId: norma.id,
          });
        }
      }
      if (/revogad/i.test(trecho)) {
        excecoes.push({
          tipo: "EXCECAO_LEGAL", impeditiva: true,
          descricao: `Dispositivo com indicação de revogação: "${trecho.slice(0, 140)}".`,
          fundamento: norma.fundamento, normaId: norma.id,
        });
      }
    }

    // 2) notas do RICMS / Convênio (informativas, não impeditivas por padrão)
    for (const nota of norma.notas.slice(0, 3)) {
      excecoes.push({
        tipo: norma.fonte.includes("Convênio") ? "NOTA_CONVENIO" : "NOTA_RICMS",
        impeditiva: false,
        descricao: nota.slice(0, 240),
        fundamento: norma.fundamento,
        normaId: norma.id,
      });
    }

    // 3) UF não signatária do acordo interestadual
    const uf = perfil.ufOrigem;
    if (uf && norma.ufsSignatarias.modo === "TODOS_EXCETO" && norma.ufsSignatarias.ufs.includes(uf)) {
      excecoes.push({
        tipo: "UF_NAO_SIGNATARIA", impeditiva: true,
        descricao: `UF de origem ${uf} está excluída do acordo (${norma.acordo || norma.protocolos.join(", ") || "—"}).`,
        fundamento: norma.fundamento, normaId: norma.id,
      });
    }

    // 4) finalidade incompatível
    for (const reg of NEGADORES_POR_TERMO) {
      if (reg.quando.test(norma.descricaoLegal) && reg.termo.test(perfil.descricaoNormalizada)) {
        excecoes.push({
          tipo: "FINALIDADE_INCOMPATIVEL", impeditiva: true,
          descricao: reg.motivo, fundamento: norma.fundamento, normaId: norma.id,
        });
      }
    }

    // 5) descrição frontalmente incompatível com NCM só de capítulo
    if (candidato.aderenciaDescricao < 0.12 && candidato.digitosCoincidentes < 6) {
      excecoes.push({
        tipo: "DESCRICAO_INCOMPATIVEL", impeditiva: true,
        descricao: "Descrição do produto não guarda relação com a descrição legal e o NCM coincide apenas em nível genérico.",
        fundamento: norma.fundamento, normaId: norma.id,
      });
    }

    return excecoes;
  },

  possuiImpeditiva(excecoes: Excecao[]): boolean {
    return excecoes.some((e) => e.impeditiva);
  },
};
