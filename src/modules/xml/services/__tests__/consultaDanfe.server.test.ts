import { describe, expect, it, vi } from "vitest";
import {
  consultarXmlConsultaDanfe,
  ErroConsultaDanfe,
  normalizarXmlConsultaDanfe,
  ProvedorConsultaDanfe,
} from "../consultaDanfe.server";

describe("consultarXmlConsultaDanfe", () => {
  it("decodifica o XML devolvido em base64", async () => {
    const xml = '<?xml version="1.0"?><nfeProc/>';
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ xml_base64: Buffer.from(xml).toString("base64") }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(consultarXmlConsultaDanfe("1".repeat(44), fetcher)).resolves.toBe(xml);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("implementa o contrato comum sem alterar a API pública legada", async () => {
    const xml = '<?xml version="1.0"?><nfeProc/>';
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ xml_base64: Buffer.from(xml).toString("base64") }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provedor = new ProvedorConsultaDanfe(fetcher);

    const resultado = await provedor.consultarXml("1".repeat(44));
    expect(resultado).toMatchObject({
      chave: "1".repeat(44),
      situacao: "DESCONHECIDA",
      provedor: "CONSULTA_DANFE",
      oficial: false,
    });
    expect(resultado.xml?.toString("utf8")).toBe(xml);
    expect(resultado.duracaoMs).toBeGreaterThanOrEqual(0);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("normaliza a serialização reconstruída pelo provedor", () => {
    const reconstruido =
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<nfeProc versao="4.00"><NFe><infNFe Id="NFe123"><infAdic><infCpl>alinea "a"</infCpl></infAdic></infNFe></NFe><versao>4.00</versao></nfeProc>';
    const esperado =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<nfeProc versao="4.00"><NFe><infNFe Id="NFe123" versao="4.00"><infAdic><infCpl>alinea &quot;a&quot;</infCpl></infAdic></infNFe></NFe><versao>4.00</versao></nfeProc>';

    expect(normalizarXmlConsultaDanfe(reconstruido)).toBe(esperado);
    expect(normalizarXmlConsultaDanfe(esperado)).toBe(esperado);
  });

  it("trata limite HTTP 429 como falha repetível", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Limite atingido." }), { status: 429 }),
      );

    const erro = await consultarXmlConsultaDanfe("1".repeat(44), fetcher).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroConsultaDanfe);
    expect(erro).toMatchObject({ codigo: "HTTP_429", repetivel: true });
  });

  it("rejeita resposta sem XML sem insistir indefinidamente", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "NF-e não localizada." }), { status: 200 }),
      );

    const erro = await consultarXmlConsultaDanfe("1".repeat(44), fetcher).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "XML_NAO_DISPONIVEL", repetivel: false });
  });
});
