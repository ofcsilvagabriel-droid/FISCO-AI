import { describe, expect, it } from "vitest";
import { ArquivoFiscalService } from "../ArquivoFiscalService";
import { reconciliarHistoricoComDocumentos } from "../HistoricoImportacaoService";

const CHAVE = "1".repeat(44);
const CNPJ = "12345678000195";

describe("reconciliação da empresa pelo destinatário confirmado no XML", () => {
  it("move registro legado sem empresa para o CNPJ e competência confirmados", () => {
    const arquivo = {
      SEM_DESTINATARIO: {
        cnpj: "",
        razaoSocial: "Sem destinatário",
        registros: [
          {
            id: `NFe${CHAVE}`,
            chaveNFe: `NFe${CHAVE}`,
            mesAno: "Saída/2026",
            destinatarioCnpj: "",
            produtos: [{ ncm: "01010101" }],
          },
        ],
      },
    };
    const resultado = ArquivoFiscalService.reconciliarComDocumentos(
      arquivo,
      [{ chave_acesso: CHAVE, cnpj: CNPJ, data_emissao: "2026-10-22T10:00:00-03:00", uf_destino: "BA" }],
      { [CNPJ]: "EMPRESA TESTE" },
    );

    expect(resultado.alterado).toBe(true);
    expect(resultado.dados).not.toHaveProperty("SEM_DESTINATARIO");
    expect(resultado.dados[CNPJ]).toMatchObject({
      cnpj: CNPJ,
      razaoSocial: "EMPRESA TESTE",
      registros: [
        {
          destinatarioCnpj: CNPJ,
          destinatarioNome: "EMPRESA TESTE",
          dataEmissao: "2026-10-22T10:00:00-03:00",
          mesAno: "2026-10",
          ufDestino: "BA",
          produtos: [{ ncm: "01010101" }],
        },
      ],
    });
  });

  it("atualiza o Histórico sem modificar notas que não possuem XML correspondente", () => {
    const outraChave = "2".repeat(44);
    const historico = [
      { id: 1, nota: { chave: `NFe${CHAVE}`, destinatario_cnpj: "", data_emissao: "" } },
      { id: 2, nota: { chave: `NFe${outraChave}`, destinatario_cnpj: "99999999000199" } },
    ];
    const resultado = reconciliarHistoricoComDocumentos(
      historico,
      [{ chave_acesso: CHAVE, cnpj: CNPJ, data_emissao: "2026-10-22", uf_destino: "BA" }],
      { [CNPJ]: "EMPRESA TESTE" },
    );

    expect(resultado.alterado).toBe(true);
    expect(resultado.dados[0].nota).toMatchObject({
      destinatario_cnpj: CNPJ,
      destinatario_nome: "EMPRESA TESTE",
      data_emissao: "2026-10-22",
      uf_destino: "BA",
    });
    expect(resultado.dados[1]).toBe(historico[1]);
  });
});
