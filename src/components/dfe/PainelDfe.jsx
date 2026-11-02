import { useCallback, useEffect, useMemo, useState } from "react";
import { listarEmpresasFisco } from "@/modules/empresas/empresas.functions";
import { baixarDocumentoDfe, marcarDocumentosDfe } from "@/modules/dfe/services/distribuicaoDfe.functions";
import { importarXmlManualNoHub } from "@/modules/dfe/services/importacaoManual.functions";
import { criarLoteRecuperacaoXml, listarCentralXml } from "@/modules/xml/services/recuperacaoXml.functions";
import { parsearNFe } from "@/modules/xml/services/parsearNFe";

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
};

export default function PainelDfe({ S, C, onImport, onNavigate }) {
  const [empresas, setEmpresas] = useState([]);
  const [selecionada, setSelecionada] = useState("");
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [chavesTexto, setChavesTexto] = useState("");
  const [dados, setDados] = useState({ lotes: [], itens: [], documentos: [], indicadores: {} });
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
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

  useEffect(() => { carregar().catch(e => setErro(erroTexto(e))); }, [carregar]);
  useEffect(() => { atualizar().catch(e => setErro(erroTexto(e))); }, [atualizar]);
  useEffect(() => {
    if (!selecionada) return undefined;
    const timer = window.setInterval(() => atualizar().catch(() => {}), 60000);
    return () => window.clearInterval(timer);
  }, [selecionada, atualizar]);

  const enfileirar = async origem => {
    if (!selecionada || !chaves.length) return;
    setOcupado("fila"); setErro(""); setAviso("");
    try {
      const resultado = await criarLoteRecuperacaoXml({ data: { cnpj: selecionada, chaves, origem } });
      setChavesTexto(""); await atualizar();
      setAviso(`${resultado.enfileiradas} chave(s) adicionada(s) à nossa API${resultado.duplicadas ? `; ${resultado.duplicadas} já cadastrada(s)` : ""}.`);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const receberArquivo = async evento => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo || !selecionada) return;
    setOcupado("arquivo"); setErro(""); setAviso("");
    try {
      const texto = await arquivo.text();
      if (/\.xml$/i.test(arquivo.name) || /^\s*</.test(texto)) {
        const analisado = parsearNFe(texto);
        if (analisado.erro || !analisado.nota) throw new Error(analisado.erro || "XML de NF-e inválido.");
        if (digitos(analisado.nota.destinatario_cnpj) !== selecionada) throw new Error("O destinatário do XML não corresponde à empresa selecionada.");
        const persistido = await importarXmlManualNoHub({ data: { empresaCnpj: selecionada, xml: texto } });
        const resumo = await onImport?.([{ name: arquivo.name, text: async () => texto, fiscoaiHubDocumento: true }]);
        const detalhe = resumo?.detalhes?.[0];
        const status = detalhe?.status === "ok" ? analisado.nota.uf_origem === analisado.nota.uf_destino ? "interna" : "importada" : "falha";
        await marcarDocumentosDfe({ data: { items: [{ id: persistido.documentoId, status, erro: detalhe?.motivo }] } });
        setAviso(persistido.duplicado ? "XML já existente; vínculo confirmado." : "XML validado, armazenado e processado.");
      } else {
        const encontradas = extrairChaves(texto);
        if (!encontradas.length) throw new Error("Nenhuma chave de acesso de 44 dígitos foi encontrada no arquivo.");
        const resultado = await criarLoteRecuperacaoXml({ data: { cnpj: selecionada, chaves: encontradas, origem: "ARQUIVO_CHAVES" } });
        setAviso(`${resultado.enfileiradas} chave(s) adicionada(s) à nossa API.`);
      }
      await atualizar();
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); evento.target.value = ""; }
  };

  const baixar = async documento => {
    setOcupado(documento.id); setErro("");
    try {
      const resultado = await baixarDocumentoDfe({ data: { id: documento.id } });
      const url = URL.createObjectURL(new Blob([resultado.xml], { type: "application/xml" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${documento.chave_acesso || documento.numero_nfe}.xml`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

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
      <label style={{ ...S.btn("primary"), cursor: ocupado ? "wait" : "pointer" }}>{ocupado === "arquivo" ? "Processando…" : "Enviar XML ou lista de chaves"}<input type="file" accept=".xml,.txt,.csv,text/xml,application/xml,text/plain,text/csv" disabled={!!ocupado || !selecionada} onChange={receberArquivo} style={{ display: "none" }}/></label>
    </header>
    {erro && <div role="alert" style={S.alert("error")}>{erro}</div>}
    {aviso && <div role="status" style={S.alert("success")}>{aviso}</div>}
    <div role="status" style={S.alert("warn")}><strong>Transição da API:</strong> a consulta NSU foi desativada. A fila própria já está ativa; o worker do Consulta DANFE será habilitado após o teste autorizado do provedor.</div>

    <section style={{ ...S.card, display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
        <label style={{ fontSize: 12 }}>Empresa<select value={selecionada} onChange={e => setSelecionada(e.target.value)} style={{ ...S.inp, width: "100%" }}><option value="">Selecione</option>{empresas.map(item => <option key={item.cnpj} value={item.cnpj}>{item.nome_fantasia || item.razao_social} — {formatarCnpj(item.cnpj)}</option>)}</select></label>
        <label style={{ fontSize: 12 }}>Competência dos XMLs<input type="month" value={competencia} onChange={e => e.target.value && setCompetencia(e.target.value)} style={{ ...S.inp, width: "100%" }}/></label>
      </div>
      {empresa ? <div style={{ color: C.muted, fontSize: 12 }}>Empresa ativa: <strong style={{ color: C.text }}>{empresa.razao_social}</strong></div> : <button onClick={() => onNavigate?.("empresas")} style={S.btn("primary")}>Cadastrar empresa</button>}
    </section>

    {selecionada && <>
      <section style={{ ...S.statsGrid, gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10 }}>{stats.map(([titulo, valor, texto, cor]) => <div key={titulo} style={{ ...S.card, minHeight: 100, padding: "14px 16px" }}><div style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}>{titulo}</div><div style={{ color: `rgb(${cor})`, fontSize: 25, fontWeight: 700, marginTop: 7 }}>{Number(valor).toLocaleString("pt-BR")}</div><div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{texto}</div></div>)}</section>

      <section style={{ ...S.card, display: "grid", gap: 10 }}>
        <div style={S.cardTitle}>Recuperar XML por chave</div><div style={{ color: C.muted, fontSize: 12 }}>Cole uma ou várias chaves. O sistema elimina duplicidades e cria um lote rastreável.</div>
        <textarea value={chavesTexto} onChange={e => setChavesTexto(e.target.value)} rows={5} placeholder="Cole as chaves de acesso de 44 dígitos, uma por linha" style={{ ...S.inp, width: "100%", resize: "vertical" }}/>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span style={{ color: C.muted, fontSize: 12 }}>{chaves.length} chave(s) reconhecida(s)</span><button onClick={() => enfileirar("CHAVES_COLADAS")} disabled={!chaves.length || ocupado === "fila"} style={S.btn("primary")}>{ocupado === "fila" ? "Criando lote…" : "Adicionar à fila"}</button></div>
      </section>

      <section style={S.card}><div style={S.cardTitle}>Fila de recuperação</div>
        {!dados.itens.length ? <div style={{ color: C.muted, padding: "22px 0" }}>Nenhuma chave cadastrada para esta empresa.</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr style={{ color: C.muted, textAlign: "left" }}><th style={{ padding: "10px 8px" }}>Chave</th><th>Status</th><th>Tentativas</th><th>Atualização</th></tr></thead><tbody>{dados.itens.map(item => <tr key={item.id} style={{ borderTop: `1px solid ${C.border}` }}><td style={{ padding: "11px 8px", fontFamily: "monospace" }}>{item.chave_acesso}</td><td><span style={{ color: ["ARMAZENADA", "IMPORTADA", "DUPLICADA"].includes(item.status) ? `rgb(${C.green})` : item.status === "NA_FILA" ? `rgb(${C.yellow})` : "#fca5a5" }}>{STATUS[item.status] || item.status}</span>{item.ultimo_erro && <div style={{ color: "#fca5a5", marginTop: 3 }}>{item.ultimo_erro}</div>}</td><td>{item.tentativas}</td><td>{dataHora(item.atualizado_em)}</td></tr>)}</tbody></table></div>}
      </section>

      <section style={S.card}><div style={S.cardTitle}>XMLs armazenados · {competencia.split("-").reverse().join("/")}</div>
        {!dados.documentos.length ? <div style={{ color: C.muted, padding: "22px 0" }}>Nenhum XML completo nesta competência.</div> : <div style={{ display: "grid" }}>{dados.documentos.map(doc => <div key={doc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 0", borderBottom: `1px solid ${C.border}` }}><div style={{ minWidth: 240, flex: 1 }}><strong>NF-e {doc.numero_nfe || "—"}{doc.serie_nfe ? ` · Série ${doc.serie_nfe}` : ""}</strong>{doc.emitente_nome ? ` · ${doc.emitente_nome}` : ""}<div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{doc.uf_origem && doc.uf_destino ? `${doc.uf_origem} → ${doc.uf_destino} · ` : ""}{new Date(doc.data_emissao).toLocaleDateString("pt-BR")} · {dinheiro(doc.valor_total_xml)}</div></div><span style={{ color: doc.processamento_status === "falha" ? "#fca5a5" : `rgb(${C.green})`, fontSize: 12, fontWeight: 600 }}>{doc.processamento_status === "importada" ? "Importada para cálculo" : doc.processamento_status === "interna" ? "Arquivada · mesma UF" : doc.processamento_status}</span><button disabled={ocupado === doc.id} onClick={() => baixar(doc)} style={S.btn("ghost")}>Baixar XML</button></div>)}</div>}
      </section>
    </>}
  </div>;
}
