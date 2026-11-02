import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listarEmpresasFisco } from "@/modules/empresas/empresas.functions";
import { baixarDocumentoFiscal, baixarDocumentosFiscaisEmLote, listarDocumentosFiscaisParaExportacao, marcarDocumentosFiscais } from "@/modules/dfe/services/documentosFiscais.functions";
import { importarXmlManualNoHub } from "@/modules/dfe/services/importacaoManual.functions";
import { criarLoteRecuperacaoXml, listarCaixaEntradaFiscal, listarCentralXml, processarCaixaEntradaFiscal } from "@/modules/xml/services/recuperacaoXml.functions";
import { parsearNFe } from "@/modules/xml/services/parsearNFe";
import { interpretarPlanilhaSefazCsv, prepararItensCaixaEntradaPlanilhaSefaz } from "@/modules/xml/domain/planilhaSefaz";

const digitos = valor => String(valor || "").replace(/\D/g, "");
const erroTexto = erro => erro?.message || String(erro || "Falha inesperada.");
const competenciaAtual = () => new Date().toISOString().slice(0, 7);
const formatarCnpj = valor => digitos(valor).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const extrairChaves = texto => [...new Set((String(texto || "").match(/\d{44}/g) || []))];
const dinheiro = valor => Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataHora = valor => valor ? new Date(valor).toLocaleString("pt-BR") : "—";

const STATUS = {
  NA_FILA: "Na fila", CONSULTANDO: "Consultando", BAIXADA: "XML baixado",
  VALIDANDO_XML: "Validando XML", ARMAZENADA: "Armazenada", IMPORTADA: "Importada",
  DUPLICADA: "Já existente", CHAVE_INVALIDA: "Chave inválida", NAO_ENCONTRADA: "Não encontrada",
  XML_INCOMPLETO: "XML incompleto", PROVEDOR_INDISPONIVEL: "Provedor indisponível",
  BLOQUEADA: "Consulta bloqueada", FALHA_DEFINITIVA: "Falha definitiva",
  AGUARDANDO_EMPRESA: "Aguardando cadastro da empresa",
};

export default function PainelDfe({ S, C, onImport, onNavigate, empresaInicial = "" }) {
  const [empresas, setEmpresas] = useState([]);
  const [selecionada, setSelecionada] = useState("");
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [chavesTexto, setChavesTexto] = useState("");
  const [dados, setDados] = useState({ lotes: [], itens: [], documentos: [], indicadores: {} });
  const [caixa, setCaixa] = useState({ lotes: [], itens: [], indicadores: {} });
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [planilhaPendente, setPlanilhaPendente] = useState(null);
  const [progressoExportacao, setProgressoExportacao] = useState(0);
  const processamentoAutomatico = useRef(new Set());
  const empresa = useMemo(() => empresas.find(item => item.cnpj === selecionada) || null, [empresas, selecionada]);
  const chaves = useMemo(() => extrairChaves(chavesTexto), [chavesTexto]);

  const carregar = useCallback(async () => {
    const lista = await listarEmpresasFisco();
    setEmpresas(lista);
    setSelecionada(atual => atual || lista[0]?.cnpj || "");
  }, []);
  const atualizar = useCallback(async () => {
    if (!selecionada) return setDados({ lotes: [], itens: [], documentos: [], indicadores: {} });
    setDados(await listarCentralXml({ data: { cnpj: selecionada, competencia } }));
  }, [selecionada, competencia]);
  const atualizarCaixa = useCallback(async () => {
    setCaixa(await listarCaixaEntradaFiscal());
  }, []);

  useEffect(() => { carregar().catch(e => setErro(erroTexto(e))); }, [carregar]);
  useEffect(() => { if (empresaInicial) setSelecionada(empresaInicial); }, [empresaInicial]);
  useEffect(() => { atualizar().catch(e => setErro(erroTexto(e))); }, [atualizar]);
  useEffect(() => { atualizarCaixa().catch(e => setErro(erroTexto(e))); }, [atualizarCaixa]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      atualizarCaixa().catch(() => {});
      if (selecionada) atualizar().catch(() => {});
    }, 60000);
    return () => window.clearInterval(timer);
  }, [selecionada, atualizar, atualizarCaixa]);

  const enfileirar = async origem => {
    if (!chaves.length) return;
    setOcupado("fila"); setErro(""); setAviso("");
    try {
      const resultado = await criarLotes(chaves, origem);
      setChavesTexto(""); await atualizarCaixa();
      setAviso(`${resultado.enfileiradas} chave(s) adicionada(s) à Caixa de Entrada${resultado.duplicadas ? `; ${resultado.duplicadas} já cadastrada(s)` : ""}.`);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const criarLotes = async (lista, origem, nomeArquivo = null) => {
    let enfileiradas = 0;
    let duplicadas = 0;
    let identificadas = 0;
    let aguardandoIdentificacao = 0;
    for (let inicio = 0; inicio < lista.length; inicio += 500) {
      const parte = lista.slice(inicio, inicio + 500);
      const resultado = await criarLoteRecuperacaoXml({
        data: {
          ...(typeof parte[0] === "string" ? { chaves: parte } : { itens: parte }),
          origem,
          nomeArquivo,
        },
      });
      enfileiradas += resultado.enfileiradas;
      duplicadas += resultado.duplicadas;
      identificadas += resultado.identificadas;
      aguardandoIdentificacao += resultado.aguardandoIdentificacao;
    }
    return { enfileiradas, duplicadas, identificadas, aguardandoIdentificacao };
  };

  const processarAgora = async () => {
    setOcupado("worker"); setErro(""); setAviso("");
    try {
      const resultado = await processarCaixaEntradaFiscal({ data: { limite: 5 } });
      await Promise.all([atualizarCaixa(), selecionada ? atualizar() : Promise.resolve()]);
      setAviso(resultado.reivindicados ? `${resultado.recuperados} XML(s) recuperado(s); ${resultado.adiados} adiado(s) pelo provedor e ${resultado.falhas} com falha.` : "Nenhuma chave está disponível para processamento agora.");
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const confirmarPlanilha = async () => {
    if (!planilhaPendente?.itens?.length) return;
    setOcupado("planilha"); setErro(""); setAviso("");
    try {
      const resultado = await criarLotes(planilhaPendente.itens, "ARQUIVO_CHAVES", planilhaPendente.nome);
      setPlanilhaPendente(null); await atualizarCaixa();
      setAviso(`${resultado.enfileiradas} chave(s) recebida(s); ${resultado.identificadas} com empresa indicada e ${resultado.aguardandoIdentificacao} aguardando confirmação pelo XML${resultado.duplicadas ? `; ${resultado.duplicadas} já cadastrada(s)` : ""}.`);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const receberArquivo = async evento => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setOcupado("arquivo"); setErro(""); setAviso("");
    try {
      const texto = await arquivo.text();
      if (/\.xml$/i.test(arquivo.name) || /^\s*</.test(texto)) {
        const analisado = parsearNFe(texto);
        if (analisado.erro || !analisado.nota) throw new Error(analisado.erro || "XML de NF-e inválido.");
        const persistido = await importarXmlManualNoHub({ data: { xml: texto } });
        const resumo = await onImport?.([{ name: arquivo.name, text: async () => texto, fiscoaiHubDocumento: true }]);
        const detalhe = resumo?.detalhes?.[0];
        const status = detalhe?.status === "ok" ? analisado.nota.uf_origem === analisado.nota.uf_destino ? "interna" : "importada" : "falha";
        await marcarDocumentosFiscais({ data: { items: [{ id: persistido.documentoId, status, erro: detalhe?.motivo }] } });
        setAviso(persistido.duplicado ? "XML já existente; vínculo confirmado." : "XML validado, armazenado e processado.");
      } else if (/\.csv$/i.test(arquivo.name)) {
        const resultado = interpretarPlanilhaSefazCsv(texto);
        if (!resultado.chaves.length) throw new Error("A planilha da SEFAZ não possui nenhuma chave de NF-e modelo 55 válida.");
        const itens = prepararItensCaixaEntradaPlanilhaSefaz(resultado);
        setPlanilhaPendente({ nome: arquivo.name, resultado, itens });
        setAviso("Planilha da SEFAZ analisada. A empresa só será definitiva após a validação do XML.");
      } else {
        const encontradas = extrairChaves(texto);
        if (!encontradas.length) throw new Error("Nenhuma chave de acesso de 44 dígitos foi encontrada no arquivo.");
        const resultado = await criarLotes(encontradas, "ARQUIVO_CHAVES");
        setAviso(`${resultado.enfileiradas} chave(s) adicionada(s) à Caixa de Entrada Fiscal.`);
      }
      await Promise.all([atualizarCaixa(), selecionada ? atualizar() : Promise.resolve()]);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); evento.target.value = ""; }
  };

  const baixar = async documento => {
    setOcupado(documento.id); setErro("");
    try {
      const resultado = await baixarDocumentoFiscal({ data: { id: documento.id } });
      const url = URL.createObjectURL(new Blob([resultado.xml], { type: "application/xml" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${documento.chave_acesso || documento.numero_nfe}.xml`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const exportarXmls = async () => {
    if (!selecionada) return;
    setOcupado("exportar"); setErro(""); setAviso(""); setProgressoExportacao(0);
    try {
      const documentos = [];
      for (let pagina = 0; ; pagina += 1) {
        const resultado = await listarDocumentosFiscaisParaExportacao({ data: { cnpj: selecionada, competencia, pagina, limite: 200 } });
        documentos.push(...resultado.documentos);
        if (!resultado.proximaPagina) break;
      }
      if (!documentos.length) throw new Error("Nenhum XML completo está disponível nesta competência.");
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (let inicio = 0; inicio < documentos.length; inicio += 25) {
        const lote = documentos.slice(inicio, inicio + 25);
        const baixados = await baixarDocumentosFiscaisEmLote({ data: { ids: lote.map(documento => documento.id) } });
        baixados.documentos.forEach(documento => zip.file(`NFe${documento.chave_acesso}.xml`, documento.xml));
        setProgressoExportacao(Math.min(documentos.length, inicio + lote.length));
      }
      const arquivo = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement("a");
      link.href = url; link.download = `FiscoAI-XMLs-${selecionada}-${competencia}.zip`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setAviso(`${documentos.length} XML(s) exportado(s) em um arquivo ZIP.`);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); setProgressoExportacao(0); }
  };

  const processarPendente = useCallback(async documento => {
    if (!onImport || processamentoAutomatico.current.has(documento.id)) return;
    processamentoAutomatico.current.add(documento.id);
    setOcupado(`processar-${documento.id}`); setErro("");
    try {
      const resultado = await baixarDocumentoFiscal({ data: { id: documento.id } });
      const resumo = await onImport([{ name: `${documento.chave_acesso || documento.numero_nfe}.xml`, text: async () => resultado.xml, fiscoaiHubDocumento: true }]);
      const detalhe = resumo?.detalhes?.[0];
      const status = detalhe?.status === "ok" ? documento.uf_origem === documento.uf_destino ? "interna" : "importada" : "falha";
      await marcarDocumentosFiscais({ data: { items: [{ id: documento.id, status, erro: detalhe?.motivo }] } });
      setAviso(status === "falha" ? "Um XML recuperado precisa de revisão." : "XML recuperado processado e vinculado à apuração da empresa.");
      await atualizar();
    } catch (e) {
      setErro(`Não foi possível processar automaticamente a NF-e ${documento.numero_nfe || ""}: ${erroTexto(e)}`);
    } finally {
      setOcupado("");
    }
  }, [atualizar, onImport]);

  useEffect(() => {
    const pendente = dados.documentos.find(documento => documento.processamento_status === "pendente" && !processamentoAutomatico.current.has(documento.id));
    if (pendente && !ocupado) processarPendente(pendente);
  }, [dados.documentos, ocupado, processarPendente]);

  const stats = [
    ["Na fila", dados.indicadores.naFila || 0, "Aguardando o worker da API", C.yellow],
    ["Recuperadas", dados.indicadores.recuperadas || 0, "XMLs obtidos por chave", C.green],
    ["XMLs da competência", dados.indicadores.documentos || 0, "Documentos completos armazenados", C.blue],
    ["Importadas para cálculo", dados.indicadores.importadas || 0, "Entradas de outras UFs", C.green],
    ["Mesma UF", dados.indicadores.internas || 0, "Arquivadas sem cálculo interestadual", C.blue],
    ["Com falha", dados.indicadores.falhas || 0, "Precisam de revisão", C.yellow],
  ];

  return <div style={{ display: "grid", gap: 14 }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
      <div><div style={{ ...S.cardTitle, fontSize: 18 }}>Central de documentos fiscais</div><div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Nossa API recebe chaves e XMLs, valida os documentos e os vincula à empresa correta.</div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button onClick={processarAgora} disabled={!!ocupado} style={S.btn("ghost")}>{ocupado === "worker" ? "Consultando…" : "Processar pendências"}</button><label style={{ ...S.btn("primary"), cursor: ocupado ? "wait" : "pointer" }}>{ocupado === "arquivo" ? "Processando…" : "Adicionar à Caixa de Entrada"}<input type="file" accept=".xml,.txt,.csv,text/xml,application/xml,text/plain,text/csv" disabled={!!ocupado} onChange={receberArquivo} style={{ display: "none" }}/></label></div>
    </header>
    {erro && <div role="alert" style={S.alert("error")}>{erro}</div>}
    {aviso && <div role="status" style={S.alert("success")}>{aviso}</div>}
    <div role="status" style={S.alert("success")}><strong>Worker conectado:</strong> o FiscoAI consulta o provedor público, valida o XML e somente depois o vincula à empresa confirmada. Limites externos geram espera automática, sem perder a chave.</div>

    <section style={{ ...S.card, display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <label style={{ fontSize: 12 }}>Filtrar acervo por empresa<select value={selecionada} onChange={e => setSelecionada(e.target.value)} style={{ ...S.inp, width: "100%" }}><option value="">Todas / nenhuma selecionada</option>{empresas.map(item => <option key={item.cnpj} value={item.cnpj}>{item.nome_fantasia || item.razao_social} — {formatarCnpj(item.cnpj)}</option>)}</select></label>
        <label style={{ fontSize: 12 }}>Competência dos XMLs<input type="month" value={competencia} onChange={e => e.target.value && setCompetencia(e.target.value)} style={{ ...S.inp, width: "100%" }}/></label>
      </div>
      <div style={{ color: C.muted, fontSize: 12 }}>O filtro não define o destino da importação. O destinatário é confirmado pelo próprio XML.</div>
    </section>

    {planilhaPendente && <section style={{ ...S.card, display: "grid", gap: 12, borderColor: `rgba(${C.blue},0.45)` }}>
      <div style={S.cardTitle}>Conferir planilha da SEFAZ</div>
      <div style={{ color: C.muted, fontSize: 12 }}>{planilhaPendente.nome} · {planilhaPendente.resultado.temColunaDestinatario ? "o CNPJ da planilha será usado apenas como indicação inicial" : "o arquivo não informa o destinatário; as chaves aguardarão o XML"}.</div>
      <div style={{ ...S.statsGrid, gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
        {[
          ["Linhas", planilhaPendente.resultado.linhas.length],
          ["NF-e válidas", planilhaPendente.itens.length],
          ["Duplicadas", planilhaPendente.resultado.duplicadas.length],
          ["Com destinatário", planilhaPendente.itens.filter(item => item.destinatarioCnpj).length],
        ].map(([titulo, valor]) => <div key={titulo} style={{ ...S.card, padding: 12 }}><div style={{ color: C.muted, fontSize: 11 }}>{titulo}</div><strong style={{ fontSize: 20 }}>{valor}</strong></div>)}
      </div>
      <div style={{ color: C.muted, fontSize: 12 }}>Situações: {Object.entries(planilhaPendente.resultado.situacoes).map(([nome, total]) => `${nome}: ${total}`).join(" · ")}<br/>UF dos emitentes: {Object.entries(planilhaPendente.resultado.ufs).map(([nome, total]) => `${nome}: ${total}`).join(" · ")}</div>
      <div style={{ color: C.muted, fontSize: 12 }}>Sem destinatário informado: {planilhaPendente.itens.filter(item => !item.destinatarioCnpj).length}. Nenhuma delas será atribuída à empresa aberta na tela.</div>
      {!!planilhaPendente.resultado.invalidas.length && <div style={S.alert("warn")}>Linhas com chave inválida: {planilhaPendente.resultado.invalidas.slice(0, 20).map(item => item.linha).join(", ")}{planilhaPendente.resultado.invalidas.length > 20 ? "…" : ""}. Elas não serão importadas.</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button onClick={() => setPlanilhaPendente(null)} disabled={!!ocupado} style={S.btn("ghost")}>Cancelar</button><button onClick={confirmarPlanilha} disabled={!!ocupado} style={S.btn("primary")}>{ocupado === "planilha" ? "Criando lotes…" : `Adicionar ${planilhaPendente.itens.length} chave(s) à Caixa`}</button></div>
    </section>}

    <section style={{ ...S.statsGrid, gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10 }}>
      {[
        ["Na Caixa", caixa.indicadores.total || 0, "Chaves recebidas", C.blue],
        ["Aguardando identificação", caixa.indicadores.aguardandoIdentificacao || 0, "Sem empresa definitiva", C.yellow],
        ["Empresa indicada", caixa.indicadores.identificadas || 0, "Aguardando confirmação do XML", C.blue],
        ["XML recuperado", caixa.indicadores.recuperadas || 0, "Documento completo", C.green],
        ["Com falha", caixa.indicadores.falhas || 0, "Exigem revisão", C.yellow],
      ].map(([titulo, valor, texto, cor]) => <div key={titulo} style={{ ...S.card, minHeight: 100, padding: "14px 16px" }}><div style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}>{titulo}</div><div style={{ color: `rgb(${cor})`, fontSize: 25, fontWeight: 700, marginTop: 7 }}>{Number(valor).toLocaleString("pt-BR")}</div><div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{texto}</div></div>)}
    </section>

    <section style={{ ...S.card, display: "grid", gap: 10 }}>
      <div style={S.cardTitle}>Adicionar chaves sem escolher empresa</div><div style={{ color: C.muted, fontSize: 12 }}>Cole uma ou várias chaves. A empresa será definida somente pelo destinatário confirmado no XML.</div>
      <textarea value={chavesTexto} onChange={e => setChavesTexto(e.target.value)} rows={5} placeholder="Cole as chaves de acesso de 44 dígitos, uma por linha" style={{ ...S.inp, width: "100%", resize: "vertical" }}/>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span style={{ color: C.muted, fontSize: 12 }}>{chaves.length} chave(s) reconhecida(s)</span><button onClick={() => enfileirar("CHAVES_COLADAS")} disabled={!chaves.length || ocupado === "fila"} style={S.btn("primary")}>{ocupado === "fila" ? "Adicionando…" : "Adicionar à Caixa"}</button></div>
    </section>

    <section style={S.card}><div style={S.cardTitle}>Caixa de Entrada Fiscal</div>
      {!caixa.itens.length ? <div style={{ color: C.muted, padding: "22px 0" }}>Nenhuma chave recebida.</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ color: C.muted, textAlign: "left" }}><th style={{ padding: "10px 8px" }}>NF-e / chave</th><th>Empresa</th><th>Status</th><th>Atualização</th></tr></thead><tbody>{caixa.itens.map(item => <tr key={item.id} style={{ borderTop: `1px solid ${C.border}` }}><td style={{ padding: "11px 8px" }}><div>{item.numero_nfe_informado ? `NF-e ${item.numero_nfe_informado}` : "NF-e"}</div><div style={{ fontFamily: "monospace", color: C.muted, fontSize: 10 }}>{item.chave_acesso}</div></td><td>{item.empresa_cnpj ? `${formatarCnpj(item.empresa_cnpj)}${item.identificacao_origem === "XML_CONFIRMADO" ? " (confirmada)" : " (indicada)"}` : item.destinatario_cnpj_informado ? `${formatarCnpj(item.destinatario_cnpj_informado)} (a confirmar)` : "Aguardando XML"}</td><td><span style={{ color: ["ARMAZENADA", "IMPORTADA", "DUPLICADA"].includes(item.status) ? `rgb(${C.green})` : item.status === "FALHA_DEFINITIVA" ? "#fca5a5" : `rgb(${C.yellow})` }}>{STATUS[item.status] || item.status}</span>{item.ultimo_erro && <div style={{ color: "#fca5a5", marginTop: 3 }}>{item.ultimo_erro}</div>}</td><td>{dataHora(item.atualizado_em)}</td></tr>)}</tbody></table></div>}
    </section>

    {selecionada && <>
      <section style={{ ...S.statsGrid, gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10 }}>{stats.map(([titulo, valor, texto, cor]) => <div key={titulo} style={{ ...S.card, minHeight: 100, padding: "14px 16px" }}><div style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}>{titulo}</div><div style={{ color: `rgb(${cor})`, fontSize: 25, fontWeight: 700, marginTop: 7 }}>{Number(valor).toLocaleString("pt-BR")}</div><div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{texto}</div></div>)}</section>

      <section style={S.card}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><div style={S.cardTitle}>XMLs armazenados · {competencia.split("-").reverse().join("/")}</div><button onClick={exportarXmls} disabled={!dados.indicadores.documentos || !!ocupado} style={S.btn("ghost")}>{ocupado === "exportar" ? `Exportando ${progressoExportacao}/${dados.indicadores.documentos}…` : "Exportar XMLs (.zip)"}</button></div>
        {!dados.documentos.length ? <div style={{ color: C.muted, padding: "22px 0" }}>Nenhum XML completo nesta competência.</div> : <div style={{ display: "grid" }}>{dados.documentos.map(doc => <div key={doc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 0", borderBottom: `1px solid ${C.border}` }}><div style={{ minWidth: 240, flex: 1 }}><strong>NF-e {doc.numero_nfe || "—"}{doc.serie_nfe ? ` · Série ${doc.serie_nfe}` : ""}</strong>{doc.emitente_nome ? ` · ${doc.emitente_nome}` : ""}<div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{doc.uf_origem && doc.uf_destino ? `${doc.uf_origem} → ${doc.uf_destino} · ` : ""}{new Date(doc.data_emissao).toLocaleDateString("pt-BR")} · {dinheiro(doc.valor_total_xml)}</div></div><span style={{ color: doc.processamento_status === "falha" ? "#fca5a5" : `rgb(${C.green})`, fontSize: 12, fontWeight: 600 }}>{doc.processamento_status === "importada" ? "Importada para cálculo" : doc.processamento_status === "interna" ? "Arquivada · mesma UF" : doc.processamento_status}</span><button disabled={ocupado === doc.id} onClick={() => baixar(doc)} style={S.btn("ghost")}>Baixar XML</button></div>)}</div>}
      </section>
    </>}
  </div>;
}
