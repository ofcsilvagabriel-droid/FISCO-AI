import { chaveNfeValida } from "./chaveNfe";

const normalizarCabecalho = (valor: unknown) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function separarLinhaCsv(linha: string, delimitador = ";") {
  const campos: string[] = [];
  let campo = "";
  let entreAspas = false;
  for (let indice = 0; indice < linha.length; indice += 1) {
    const caractere = linha[indice];
    if (caractere === '"') {
      if (entreAspas && linha[indice + 1] === '"') {
        campo += '"';
        indice += 1;
      } else {
        entreAspas = !entreAspas;
      }
    } else if (caractere === delimitador && !entreAspas) {
      campos.push(campo.trim());
      campo = "";
    } else {
      campo += caractere;
    }
  }
  campos.push(campo.trim());
  return campos;
}

const contar = (valores: string[]) =>
  valores.reduce<Record<string, number>>((total, valor) => {
    const chave = valor.trim() || "Não informado";
    total[chave] = (total[chave] || 0) + 1;
    return total;
  }, {});

export type LinhaPlanilhaSefaz = {
  linha: number;
  numeroNfe: string;
  emitenteCnpj: string;
  emitenteNome: string;
  dataEmissao: string;
  valor: string;
  chave: string;
  ufEmitente: string;
  situacao: string;
  tipoOperacao: string;
  destinatarioCnpj: string;
  destinatarioNome: string;
};

export function interpretarPlanilhaSefazCsv(conteudo: string) {
  const linhasTexto = String(conteudo || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((linha) => linha.trim());
  if (!linhasTexto.length) throw new Error("A planilha da SEFAZ está vazia.");

  const cabecalhos = separarLinhaCsv(linhasTexto[0]);
  const indices = new Map(
    cabecalhos.map((cabecalho, indice) => [normalizarCabecalho(cabecalho), indice]),
  );
  const indiceDe = (...nomes: string[]) => {
    for (const nome of nomes) {
      const indice = indices.get(nome);
      if (indice != null) return indice;
    }
    return undefined;
  };
  const indiceChave = indiceDe("chave de acesso", "chave nf e", "chave nfe", "chnfe");
  const indiceCnpjDestinatario = indiceDe(
    "cnpj cpf destinatario",
    "cpf cnpj destinatario",
    "cnpj destinatario",
  );
  const indiceNomeDestinatario = indiceDe(
    "razao social destinatario",
    "nome destinatario",
    "destinatario",
  );
  if (indiceChave == null)
    throw new Error('A planilha não possui a coluna "Chave de Acesso" do relatório da SEFAZ.');

  const obter = (campos: string[], nome: string) => {
    const indice = indices.get(nome);
    return indice == null ? "" : String(campos[indice] || "").trim();
  };
  const linhas: LinhaPlanilhaSefaz[] = linhasTexto.slice(1).map((linha, indice) => {
    const campos = separarLinhaCsv(linha);
    return {
      linha: indice + 2,
      numeroNfe: obter(campos, "numero nf e"),
      emitenteCnpj: obter(campos, "cnpj cpf emitente"),
      emitenteNome: obter(campos, "razao social emitente"),
      dataEmissao: obter(campos, "data de emissao"),
      valor: obter(campos, "valor"),
      chave: String(campos[indiceChave] || "").replace(/\D/g, ""),
      ufEmitente: obter(campos, "uf emit"),
      situacao: obter(campos, "situacao"),
      tipoOperacao: obter(campos, "tipo operacao"),
      destinatarioCnpj:
        indiceCnpjDestinatario == null
          ? ""
          : String(campos[indiceCnpjDestinatario] || "").replace(/\D/g, ""),
      destinatarioNome:
        indiceNomeDestinatario == null ? "" : String(campos[indiceNomeDestinatario] || "").trim(),
    };
  });

  const validas = linhas.filter((linha) => chaveNfeValida(linha.chave));
  const invalidas = linhas.filter((linha) => !chaveNfeValida(linha.chave));
  const vistas = new Set<string>();
  const duplicadas: LinhaPlanilhaSefaz[] = [];
  const chaves: string[] = [];
  validas.forEach((linha) => {
    if (vistas.has(linha.chave)) duplicadas.push(linha);
    else {
      vistas.add(linha.chave);
      chaves.push(linha.chave);
    }
  });

  return {
    linhas,
    chaves,
    invalidas,
    duplicadas,
    situacoes: contar(linhas.map((linha) => linha.situacao)),
    operacoes: contar(linhas.map((linha) => linha.tipoOperacao)),
    ufs: contar(linhas.map((linha) => linha.ufEmitente)),
    temColunaDestinatario: indiceCnpjDestinatario != null,
  };
}

export function prepararItensCaixaEntradaPlanilhaSefaz(
  resultado: ReturnType<typeof interpretarPlanilhaSefazCsv>,
) {
  const chavesValidas = new Set(resultado.chaves);
  const chavesVistas = new Set<string>();
  return resultado.linhas.flatMap((linha) => {
    if (!chavesValidas.has(linha.chave) || chavesVistas.has(linha.chave)) return [];
    chavesVistas.add(linha.chave);
    return [
      {
        chave: linha.chave,
        destinatarioCnpj: linha.destinatarioCnpj || null,
        destinatarioNome: linha.destinatarioNome || null,
        emitenteCnpj: linha.emitenteCnpj || null,
        emitenteNome: linha.emitenteNome || null,
        numeroNfe: linha.numeroNfe || null,
        dataEmissao: linha.dataEmissao || null,
        linha: linha.linha,
      },
    ];
  });
}
