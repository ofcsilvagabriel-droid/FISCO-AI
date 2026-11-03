import { describe, expect, it } from "vitest";
import { reconciliarPendenciasComAcervo } from "../recuperacaoXml.server";

function bancoFalso(tabelas: Record<string, any[]>) {
  return {
    from(nome: string) {
      let operacao: "select" | "update" = "select";
      let alteracoes: Record<string, unknown> = {};
      const filtros: Array<(item: any) => boolean> = [];
      const consulta: any = {
        select() {
          return consulta;
        },
        update(dados: Record<string, unknown>) {
          operacao = "update";
          alteracoes = dados;
          return consulta;
        },
        eq(campo: string, valor: unknown) {
          filtros.push((item) => item[campo] === valor);
          return consulta;
        },
        in(campo: string, valores: unknown[]) {
          filtros.push((item) => valores.includes(item[campo]));
          return consulta;
        },
        not(campo: string, operador: string, valores: string) {
          const lista = valores.replace(/[()\"]/g, "").split(",");
          if (operador === "in") filtros.push((item) => !lista.includes(item[campo]));
          return consulta;
        },
        is(campo: string, valor: unknown) {
          filtros.push((item) => item[campo] === valor);
          return consulta;
        },
        limit() {
          return consulta;
        },
        then(resolve: (resultado: any) => void) {
          const linhas = (tabelas[nome] || []).filter((item) => filtros.every((filtro) => filtro(item)));
          if (operacao === "update") linhas.forEach((item) => Object.assign(item, alteracoes));
          resolve({ data: operacao === "select" ? linhas : null, error: null });
        },
      };
      return consulta;
    },
  };
}

describe("reconciliação de pendências com o acervo", () => {
  it("resolve a pendência, a notificação e os totais do lote pela chave da NF-e", async () => {
    const chave = "2".repeat(44);
    const tabelas = {
      fiscoai_xml_itens: [
        {
          id: "item-1",
          user_id: "user-1",
          lote_id: "lote-1",
          chave_acesso: chave,
          status: "FALHA_DEFINITIVA",
        },
      ],
      fiscoai_dfe_documentos: [
        {
          id: "doc-1",
          user_id: "user-1",
          cnpj: "42044886000115",
          chave_acesso: chave,
          tipo_conteudo: "XML_COMPLETO",
          processamento_status: "pendente",
        },
      ],
      fiscoai_empresas: [
        { user_id: "user-1", empresa_id: "empresa-1", cnpj: "42044886000115" },
      ],
      fiscoai_xml_notificacoes: [
        { user_id: "user-1", item_id: "item-1", resolvida_em: null },
      ],
      fiscoai_xml_lotes: [
        { id: "lote-1", total_recuperados: 0, total_falhas: 1, status: "CONCLUIDO_COM_FALHAS" },
      ],
    };

    const resultado = await reconciliarPendenciasComAcervo(bancoFalso(tabelas), {
      userId: "user-1",
      chaveAcesso: chave,
    });

    expect(resultado).toEqual({ itensResolvidos: 1, lotesAtualizados: 1 });
    expect(tabelas.fiscoai_xml_itens[0]).toMatchObject({
      status: "ARMAZENADA",
      documento_id: "doc-1",
      empresa_cnpj: "42044886000115",
      identificacao_origem: "XML_CONFIRMADO",
      ultimo_erro: null,
    });
    expect(tabelas.fiscoai_xml_notificacoes[0].resolvida_em).toBeTruthy();
    expect(tabelas.fiscoai_xml_lotes[0]).toMatchObject({
      total_recuperados: 1,
      total_falhas: 0,
      status: "CONCLUIDO",
    });
  });
});
