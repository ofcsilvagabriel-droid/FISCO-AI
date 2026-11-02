import { describe, expect, it, vi } from "vitest";
import { consultarXmlConsultaDanfe, ErroConsultaDanfe } from "../consultaDanfe.server";

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
