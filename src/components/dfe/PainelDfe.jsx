import { useCallback, useEffect, useMemo, useState } from "react";
import { listarEmpresasFisco } from "@/modules/empresas/empresas.functions";
import {
  baixarDocumentoFiscal,
  baixarDocumentosFiscaisEmLote,
  listarDocumentosFiscaisParaExportacao,
  listarIndiceAcervoXml,
} from "@/modules/dfe/services/documentosFiscais.functions";
import { listarCentralXml } from "@/modules/xml/services/recuperacaoXml.functions";

const digitos = (valor) => String(valor || "").replace(/\D/g, "");
const formatarCnpj = (valor) =>
  digitos(valor).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const erroTexto = (erro) => erro?.message || String(erro || "Falha inesperada.");
const competenciaAtual = () => new Date().toISOString().slice(0, 7);
const dinheiro = (valor) =>
  Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mesLabel = (competencia) => competencia?.split("-").reverse().join("/") || "Sem competência";

export default function PainelDfe({ S, C, empresaInicial = "", empresaFixa = false }) {
  const [empresas, setEmpresas] = useState([]);
  const [selecionada, setSelecionada] = useState("");
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [uf, setUf] = useState("");
  const [indice, setIndice] = useState({ indice: {}, total: 0 });
  const [dados, setDados] = useState({ documentos: [], indicadores: {} });
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [progresso, setProgresso] = useState(0);
  const empresa = useMemo(
    () => empresas.find((item) => item.cnpj === selecionada),
    [empresas, selecionada],
  );
  const ufs = useMemo(
    () => Object.keys(indice.indice?.[competencia] || {}).sort(),
    [indice, competencia],
  );
  const documentos = useMemo(
    () => (uf ? dados.documentos.filter((item) => item.uf_origem === uf) : dados.documentos),
    [dados.documentos, uf],
  );

  const carregarEmpresas = useCallback(async () => {
    const lista = await listarEmpresasFisco();
    setEmpresas(lista);
    setSelecionada((atual) => empresaInicial || atual || lista[0]?.cnpj || "");
  }, [empresaInicial]);
  const carregarAcervo = useCallback(async () => {
    if (!selecionada) return;
    const [arvore, documentosCompetencia] = await Promise.all([
      listarIndiceAcervoXml({ data: { cnpj: selecionada } }),
      listarCentralXml({ data: { cnpj: selecionada, competencia } }),
    ]);
    setIndice(arvore);
    setDados(documentosCompetencia);
  }, [selecionada, competencia]);
  useEffect(() => {
    carregarEmpresas().catch((e) => setErro(erroTexto(e)));
  }, [carregarEmpresas]);
  useEffect(() => {
    carregarAcervo().catch((e) => setErro(erroTexto(e)));
  }, [carregarAcervo]);
  useEffect(() => {
    if (empresaInicial) setSelecionada(empresaInicial);
  }, [empresaInicial]);
  useEffect(() => {
    if (uf && !ufs.includes(uf)) setUf("");
  }, [uf, ufs]);

  const baixar = async (documento) => {
    setOcupado(documento.id);
    setErro("");
    try {
      const resultado = await baixarDocumentoFiscal({ data: { id: documento.id } });
      const url = URL.createObjectURL(new Blob([resultado.xml], { type: "application/xml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `NFe${documento.chave_acesso}.xml`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErro(erroTexto(e));
    } finally {
      setOcupado("");
    }
  };

  const exportar = async (escopo) => {
    if (!selecionada) return;
    setOcupado("exportar");
    setErro("");
    setAviso("");
    setProgresso(0);
    try {
      const encontrados = [];
      for (let pagina = 0; ; pagina += 1) {
        const resultado = await listarDocumentosFiscaisParaExportacao({
          data: {
            cnpj: selecionada,
            competencia: escopo === "empresa" ? null : competencia,
            uf: escopo === "uf" ? uf : null,
            pagina,
            limite: 200,
          },
        });
        encontrados.push(...resultado.documentos);
        if (!resultado.proximaPagina) break;
      }
      if (!encontrados.length) throw new Error("Nenhum XML completo no escopo selecionado.");
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (let inicio = 0; inicio < encontrados.length; inicio += 25) {
        const lote = encontrados.slice(inicio, inicio + 25);
        const baixados = await baixarDocumentosFiscaisEmLote({
          data: { ids: lote.map((item) => item.id) },
        });
        baixados.documentos.forEach((item) => zip.file(`${item.chave_acesso}.xml`, item.xml));
        setProgresso(Math.min(encontrados.length, inicio + lote.length));
      }
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `FiscoAI-XML-${selecionada}-${escopo === "empresa" ? "acervo-completo" : competencia}${escopo === "uf" ? `-${uf}` : ""}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setAviso(`${encontrados.length} XML(s) exportado(s).`);
    } catch (e) {
      setErro(erroTexto(e));
    } finally {
      setOcupado("");
      setProgresso(0);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ ...S.cardTitle, fontSize: 18 }}>Acervo de XMLs</div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            Documentos confirmados pelo CNPJ destinatário, organizados por competência de emissão e
            UF de origem.
          </div>
        </div>
        {selecionada && (
          <button
            onClick={() => exportar("empresa")}
            disabled={!!ocupado || !indice.total}
            style={S.btn("ghost")}
          >
            {ocupado === "exportar" ? `Exportando ${progresso}…` : "Exportar acervo da empresa"}
          </button>
        )}
      </header>
      {erro && (
        <div role="alert" style={S.alert("error")}>
          {erro}
        </div>
      )}
      {aviso && (
        <div role="status" style={S.alert("success")}>
          {aviso}
        </div>
      )}
      {!empresaFixa && (
        <section style={{ ...S.card, display: "grid", gap: 12 }}>
          <label style={{ fontSize: 12, maxWidth: 520 }}>
            Empresa
            <select
              value={selecionada}
              onChange={(e) => {
                setSelecionada(e.target.value);
                setUf("");
              }}
              style={{ ...S.inp, width: "100%" }}
            >
              <option value="">Selecione</option>
              {empresas.map((item) => (
                <option key={item.cnpj} value={item.cnpj}>
                  {item.nome_fantasia || item.razao_social} — {formatarCnpj(item.cnpj)}
                </option>
              ))}
            </select>
          </label>
          {empresa && (
            <div style={{ color: C.muted, fontSize: 11 }}>
              {empresa.razao_social} · {indice.total} XML(s) no acervo
            </div>
          )}
        </section>
      )}
      {selecionada && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px,280px) minmax(0,1fr)",
            gap: 14,
            alignItems: "start",
          }}
        >
          <aside style={S.card}>
            <div style={S.cardTitle}>Pastas</div>
            {!Object.keys(indice.indice || {}).length ? (
              <div style={{ color: C.muted, padding: "18px 0" }}>Nenhum XML armazenado.</div>
            ) : (
              Object.entries(indice.indice).map(([mes, porUf]) => (
                <div key={mes} style={{ marginBottom: 9 }}>
                  <button
                    onClick={() => {
                      setCompetencia(mes);
                      setUf("");
                    }}
                    style={{
                      ...S.histItem(competencia === mes && !uf),
                      width: "100%",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    📁 {mesLabel(mes)}{" "}
                    <span style={{ color: C.muted }}>
                      ({Object.values(porUf).reduce((a, b) => a + b, 0)})
                    </span>
                  </button>
                  {competencia === mes && (
                    <div style={{ paddingLeft: 14 }}>
                      {Object.entries(porUf)
                        .sort()
                        .map(([sigla, total]) => (
                          <button
                            key={sigla}
                            onClick={() => setUf(sigla)}
                            style={{
                              ...S.histItem(uf === sigla),
                              width: "100%",
                              textAlign: "left",
                              cursor: "pointer",
                              padding: "7px 10px",
                            }}
                          >
                            📂 {sigla} <span style={{ color: C.muted }}>({total})</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </aside>
          <section style={S.card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div>
                <div style={S.cardTitle}>
                  {mesLabel(competencia)}
                  {uf ? ` · ${uf}` : ""}
                </div>
                <div style={{ color: C.muted, fontSize: 11 }}>
                  {documentos.length} documento(s) nesta pasta
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => exportar("competencia")}
                  disabled={!!ocupado || !dados.documentos.length}
                  style={S.btn("ghost")}
                >
                  Exportar competência
                </button>
                {uf && (
                  <button
                    onClick={() => exportar("uf")}
                    disabled={!!ocupado || !documentos.length}
                    style={S.btn("ghost")}
                  >
                    Exportar UF
                  </button>
                )}
              </div>
            </div>
            {!documentos.length ? (
              <div style={{ color: C.muted, padding: "24px 0" }}>Nenhum XML nesta pasta.</div>
            ) : (
              <div style={{ display: "grid", marginTop: 10 }}>
                {documentos.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                      padding: "12px 0",
                      borderTop: `1px solid ${C.border}`,
                    }}
                  >
                    <div style={{ minWidth: 240, flex: 1 }}>
                      <strong>
                        NF-e {doc.numero_nfe || "—"}
                        {doc.serie_nfe ? ` · Série ${doc.serie_nfe}` : ""}
                      </strong>
                      {doc.emitente_nome ? ` · ${doc.emitente_nome}` : ""}
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                        {doc.uf_origem || "--"} → {doc.uf_destino || "--"} ·{" "}
                        {doc.data_emissao
                          ? new Date(doc.data_emissao).toLocaleDateString("pt-BR")
                          : "Sem data"}{" "}
                        · {dinheiro(doc.valor_total_xml)}
                      </div>
                    </div>
                    <span
                      style={{
                        color: doc.processamento_status === "falha" ? "#fca5a5" : `rgb(${C.green})`,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {doc.processamento_status === "importada"
                        ? "Importada para cálculo"
                        : doc.processamento_status === "interna"
                          ? "Arquivada · mesma UF"
                          : doc.processamento_status}
                    </span>
                    <button
                      onClick={() => baixar(doc)}
                      disabled={ocupado === doc.id}
                      style={S.btn("ghost")}
                    >
                      Baixar XML
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
