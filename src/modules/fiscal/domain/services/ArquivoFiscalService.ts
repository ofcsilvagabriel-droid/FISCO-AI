// Service: persistência local do "Arquivo Fiscal" por empresa/mês.
import { carregarFiscal, salvarFiscal } from "./PersistenciaFiscalLocal";
const ARQUIVO_KEY = "fiscoai:arquivo:v1";

export type ArquivoFiscal = Record<string, unknown>;

type IdentidadeDocumentoFiscal = {
  chave_acesso?: unknown;
  cnpj?: unknown;
  data_emissao?: unknown;
  uf_destino?: unknown;
};

const digitos = (valor: unknown) => String(valor ?? "").replace(/\D/g, "");
const chaveNfe = (valor: unknown) => {
  const normalizada = digitos(valor);
  return normalizada.length === 44 ? normalizada : "";
};

function normalizarCompetencias(arquivo: ArquivoFiscal): ArquivoFiscal {
  let alterado = false;
  const resultado: ArquivoFiscal = {};
  for (const [chave, valor] of Object.entries(arquivo || {})) {
    const empresa = valor as { registros?: Array<{ dataEmissao?: string; mesAno?: string }> } | null;
    if (!Array.isArray(empresa?.registros)) { resultado[chave] = valor; continue; }
    let empresaAlterada = false;
    const registros = empresa.registros.map(registro => {
      const encontrado = String(registro.dataEmissao || "").match(/^(\d{4})-(\d{2})/);
      if (!encontrado) return registro;
      const competencia = `${encontrado[1]}-${encontrado[2]}`;
      if (registro.mesAno === competencia) return registro;
      alterado = true;
      empresaAlterada = true;
      return { ...registro, mesAno: competencia };
    });
    resultado[chave] = empresaAlterada ? { ...(valor as object), registros } : valor;
  }
  return alterado ? resultado : arquivo;
}

function reconciliarComDocumentos(
  arquivo: ArquivoFiscal,
  documentos: IdentidadeDocumentoFiscal[],
  nomesEmpresas: Record<string, string> = {},
): { dados: ArquivoFiscal; alterado: boolean } {
  const porChave = new Map(
    (documentos || [])
      .map(documento => [chaveNfe(documento.chave_acesso), documento] as const)
      .filter(([chave, documento]) => chave && /^\d{14}$/.test(digitos(documento.cnpj))),
  );
  const resultado: ArquivoFiscal = {};
  let alterado = false;

  for (const [chaveGrupo, valor] of Object.entries(arquivo || {})) {
    const empresa = valor as {
      cnpj?: unknown;
      razaoSocial?: unknown;
      registros?: Array<Record<string, unknown>>;
    } | null;
    if (!Array.isArray(empresa?.registros)) {
      resultado[chaveGrupo] = valor;
      continue;
    }
    for (const registro of empresa.registros) {
      const chave = chaveNfe(registro.chaveNFe || registro.id);
      const documento = chave ? porChave.get(chave) : null;
      const cnpjDocumento = digitos(documento?.cnpj);
      const cnpjRegistro = digitos(registro.destinatarioCnpj || empresa.cnpj);
      const cnpjDestino = /^\d{14}$/.test(cnpjDocumento) ? cnpjDocumento : cnpjRegistro;
      if (!/^\d{14}$/.test(cnpjDestino)) {
        const grupo = resultado[chaveGrupo] as typeof empresa | undefined;
        resultado[chaveGrupo] = grupo
          ? { ...grupo, registros: [...(grupo.registros || []), registro] }
          : { ...empresa, registros: [registro] };
        continue;
      }

      const dataEmissao = String(documento?.data_emissao || registro.dataEmissao || "");
      const mesAno = ArquivoFiscalService.mesAno(dataEmissao);
      const nome = nomesEmpresas[cnpjDestino] || String(registro.destinatarioNome || empresa.razaoSocial || "");
      const atualizado: Record<string, unknown> = {
        ...registro,
        destinatarioCnpj: cnpjDestino,
        destinatarioNome: nome,
        dataEmissao,
        mesAno,
        ufDestino: String(documento?.uf_destino || registro.ufDestino || ""),
      };
      if (
        chaveGrupo !== cnpjDestino ||
        cnpjRegistro !== cnpjDestino ||
        registro.mesAno !== mesAno ||
        registro.dataEmissao !== dataEmissao ||
        registro.destinatarioNome !== nome
      ) alterado = true;

      const grupoExistente = resultado[cnpjDestino] as typeof empresa | undefined;
      const registros = [...(grupoExistente?.registros || [])];
      const duplicado = registros.findIndex(item => {
        const chaveItem = chaveNfe(item.chaveNFe || item.id);
        return (chave && chaveItem === chave) || (item.id != null && item.id === atualizado.id);
      });
      if (duplicado >= 0) {
        registros[duplicado] = atualizado;
        alterado = true;
      } else registros.push(atualizado);
      resultado[cnpjDestino] = {
        ...(grupoExistente || empresa),
        cnpj: cnpjDestino,
        razaoSocial: nome || grupoExistente?.razaoSocial || empresa.razaoSocial,
        registros,
      };
    }
  }
  return { dados: alterado ? resultado : arquivo, alterado };
}

function mesclarArquivos(remoto: ArquivoFiscal, local: ArquivoFiscal): ArquivoFiscal {
  if (!remoto || typeof remoto !== "object" || Array.isArray(remoto)) return local;
  const combinado = { ...local, ...remoto };
  for (const chave of Object.keys(local)) {
    const empresaLocal = local[chave] as { registros?: Array<{ id?: unknown }> } | null;
    const empresaRemota = remoto[chave] as { registros?: Array<{ id?: unknown }> } | null;
    if (!Array.isArray(empresaLocal?.registros) || !Array.isArray(empresaRemota?.registros)) continue;
    const idsRemotos = new Set(empresaRemota.registros.map(registro => registro.id).filter(id => id != null));
    combinado[chave] = {
      ...empresaLocal, ...empresaRemota,
      registros: [...empresaRemota.registros, ...empresaLocal.registros.filter(registro => registro.id == null || !idsRemotos.has(registro.id))],
    };
  }
  return combinado;
}

export const ArquivoFiscalService = {
  async load(): Promise<ArquivoFiscal> {
    const dados = await carregarFiscal<ArquivoFiscal>("arquivo", ARQUIVO_KEY, {}, mesclarArquivos);
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new Error("Arquivo Fiscal salvo é inválido.");
    return normalizarCompetencias(dados);
  },
  save(data: ArquivoFiscal): Promise<void> {
    return salvarFiscal("arquivo", ARQUIVO_KEY, data);
  },
  mesAno(s: string | undefined | null): string {
    if (!s) return "0000-00";
    const m = String(s).match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : "0000-00";
  },
  chaveEmpresa(cnpj: string | undefined | null, nome: string | undefined | null): string {
    const c = (cnpj || "").replace(/\D/g, "");
    return c || (nome || "SEM_DESTINATARIO").toUpperCase();
  },
  reconciliarComDocumentos,
};
