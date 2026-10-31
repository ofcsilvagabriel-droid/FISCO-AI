import { describe, expect, it, vi } from "vitest";
import { consultarFiscalApiPorChave, validarXmlFiscalApi } from "../fiscalApi.server";

const CHAVE = "29260112345678000195550010000000071000000017";

function xmlNfe(chave = CHAVE) {
  return `<nfeProc versao="4.00"><NFe><infNFe Id="NFe${chave}"><ide><mod>55</mod><nNF>7</nNF><serie>1</serie><dhEmi>2026-01-10T10:00:00-03:00</dhEmi></ide><emit><CNPJ>98765432000100</CNPJ><xNome>Fornecedor</xNome><enderEmit><UF>SP</UF></enderEmit></emit><dest><CNPJ>12345678000276</CNPJ><enderDest><UF>BA</UF></enderDest></dest><det nItem="1"><prod><cProd>1</cProd></prod></det><total><ICMSTot><vNF>123.45</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat><nProt>123456789</nProt></infProt></protNFe></nfeProc>`;
}

describe("FiscalAPI por chave", () => {
  it("envia manifestar=false mesmo quando o provedor usa true por padrão", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "X-API-Key": "fapi_teste" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        chave: CHAVE,
        certificado: "cGZ4",
        senha: "segredo",
        manifestar: false,
      });
      return new Response(
        JSON.stringify({
          request_id: "req-1",
          total: 1,
          com_dado: 1,
          creditos_cobrados: 3,
          resultados: [
            {
              chave: CHAVE,
              status: "ok",
              cstat: "138",
              mensagem: "Documento localizado.",
              from_cache: false,
              manifestacao: null,
              xml: xmlNfe(),
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const resposta = await consultarFiscalApiPorChave(
      {
        apiKey: "fapi_teste",
        chave: CHAVE,
        certificado: "cGZ4",
        senha: "segredo",
      },
      fetchMock as typeof fetch,
    );
    expect(resposta.resultados[0].status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aceita somente NF-e completa, autorizada e vinculada ao CNPJ", () => {
    expect(validarXmlFiscalApi(xmlNfe(), CHAVE, "12345678000195").detalhes).toMatchObject({
      numero_nfe: "7",
      uf_origem: "SP",
      uf_destino: "BA",
    });
    expect(() =>
      validarXmlFiscalApi(
        xmlNfe(),
        "35260112345678000195550010000000071000000017",
        "12345678000195",
      ),
    ).toThrow(/chave do XML/);
    expect(() => validarXmlFiscalApi(xmlNfe(), CHAVE, "11111111000191")).toThrow(/vinculada/);
  });

  it("rejeita mudança desconhecida no contrato de resposta", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            request_id: "req-2",
            total: 1,
            com_dado: 0,
            creditos_cobrados: 0,
            resultados: [{ chave: CHAVE, status: "status_novo", xml: null }],
          }),
          { status: 200 },
        ),
    );
    await expect(
      consultarFiscalApiPorChave(
        {
          apiKey: "fapi_teste",
          chave: CHAVE,
          certificado: "cGZ4",
          senha: "segredo",
        },
        fetchMock as typeof fetch,
      ),
    ).rejects.toThrow();
  });
});
