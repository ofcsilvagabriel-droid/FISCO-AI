import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsearNFe } from "@/modules/xml/services/parsearNFe";
import { baixarDocumentoDfe, consultarDfe, listarDocumentosDfe, marcarDocumentosDfe } from "@/modules/dfe/services/distribuicaoDfe.functions";
import { existeLoteDfePendente, INTERVALO_MINIMO_BUSCA_DFE_MS } from "@/modules/dfe/services/distribuicaoDfe.shared";
import { listarEmpresasFisco } from "@/modules/empresas/empresas.functions";

const dataBR = valor => valor ? new Date(valor).toLocaleDateString("pt-BR") : "—";
const mensagem = erro => erro?.message || String(erro || "Falha inesperada.");
const limparCnpj = valor => String(valor || "").replace(/[^0-9a-z]/gi, "").toUpperCase();
const baseCnpj = valor => limparCnpj(valor).slice(0, 8);
const PAGE_SIZE = 100;
const pastaDataEmissao = valor => {
  const match = String(valor || "").match(/^(\d{4})-(0[1-9]|1[0-2])/);
  return match ? { ano: match[1], mes: match[2], chave: `${match[1]}-${match[2]}` } : { ano: "Sem competência", mes: "Sem competência", chave: "sem-competencia" };
};
const rotuloCompetencia = chave => chave === "sem-competencia" ? "Sem competência" : `${chave.slice(5, 7)}/${chave.slice(0, 4)}`;
const competenciaAtual = () => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
};

function notaEntradaElegivel(nota, cnpjCertificado) {
  const emitente = limparCnpj(nota?.emitente_cnpj);
  const destinatario = limparCnpj(nota?.destinatario_cnpj);
  const origem = String(nota?.uf_origem || "").toUpperCase();
  const destino = String(nota?.uf_destino || "").toUpperCase();
  return String(nota?.modelo || "") === "55"
    && baseCnpj(destinatario) !== ""
    && baseCnpj(destinatario) === baseCnpj(cnpjCertificado)
    && emitente !== destinatario
    && /^[A-Z]{2}$/.test(origem)
    && /^[A-Z]{2}$/.test(destino);
}

export default function PainelDfe({ S, C, onImport, onNavigate }) {
  const [empresas, setEmpresas] = useState([]);
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [selecionado, setSelecionado] = useState("");
  const [documentos, setDocumentos] = useState([]);
  const [indicadores, setIndicadores] = useState({ total: 0, importadas: 0, internas: 0, pendentes: 0, falhas: 0, resumos: 0, falhasCiencia: 0, monitoradas: 0, ultimaBusca: null });
  const [pagina, setPagina] = useState(0);
  const [temMais, setTemMais] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [horaAtual, setHoraAtual] = useState(Date.now());
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const onImportRef = useRef(onImport);
  const filasAtivas = useRef(new Set());

  useEffect(() => { onImportRef.current = onImport; }, [onImport]);
  useEffect(() => {
    const timer = window.setInterval(() => setHoraAtual(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const atualizarEmpresas = useCallback(async () => {
    const lista = await listarEmpresasFisco();
    setEmpresas(lista);
    setSelecionado(atual => atual || lista.find(empresa => empresa.ativa && empresa.certificado?.validade_fim)?.cnpj || "");
    return lista;
  }, []);

  const atualizarDocumentos = useCallback(async (alvo, paginaAlvo = 0, acrescentar = false) => {
    if (!alvo) { setDocumentos([]); setCursor(null); setTemMais(false); setIndicadores({ total: 0, importadas: 0, internas: 0, pendentes: 0, falhas: 0, resumos: 0, falhasCiencia: 0, monitoradas: 0, ultimaBusca: null }); return { documentos: [], pendentes: [], cursor: null, temMais: false }; }
    const resultado = await listarDocumentosDfe({ data: { cnpj: alvo, competencia, offset: paginaAlvo * PAGE_SIZE } });
    setDocumentos(atual => {
      const base = acrescentar ? atual : [];
      const porId = new Map([...base, ...(resultado.documentos || [])].map(documento => [documento.id, documento]));
      return [...porId.values()];
    });
    setCursor(resultado.cursor);
    setTemMais(!!resultado.temMais);
    setIndicadores(resultado.indicadores || {});
    return resultado;
  }, [competencia]);

  const processarPendentes = useCallback(async (alvo, exibirProgresso = false) => {
    if (!alvo || filasAtivas.current.has(alvo)) return { importadas: 0, internas: 0, descartadas: 0, falhas: 0 };
    filasAtivas.current.add(alvo);
    const totais = { importadas: 0, internas: 0, descartadas: 0, falhas: 0 };
    try {
      while (true) {
        const resultado = await atualizarDocumentos(alvo);
        const lote = resultado.pendentes || [];
        if (!lote.length) break;
        const paraImportar = [];
        const atualizacoes = [];
        for (const documento of lote) {
          try {
            const baixado = await baixarDocumentoDfe({ data: { id: documento.id } });
            const parsed = parsearNFe(baixado.xml);
            if (parsed.erro || !parsed.nota || !parsed.produtos.length) {
              atualizacoes.push({ id: documento.id, status: "falha", erro: parsed.erro || "XML sem itens de NF-e." });
              totais.falhas++;
            } else if (!notaEntradaElegivel(parsed.nota, alvo)) {
              atualizacoes.push({ id: documento.id, status: "descartada" });
              totais.descartadas++;
            } else if (parsed.nota.uf_origem === parsed.nota.uf_destino) {
              atualizacoes.push({ id: documento.id, status: "interna" });
              totais.internas++;
            } else {
              paraImportar.push({ documento, xml: baixado.xml, nomeArquivo: `${documento.id}.xml` });
            }
          } catch (e) {
            atualizacoes.push({ id: documento.id, status: "falha", erro: mensagem(e).slice(0, 500) });
            totais.falhas++;
          }
        }
        if (paraImportar.length) {
          try {
            const resumo = await onImportRef.current(paraImportar.map(item => ({
              name: item.nomeArquivo,
              text: async () => item.xml,
            })));
            const detalhePorArquivo = new Map((resumo?.detalhes || []).map(item => [item.arquivo, item]));
            for (const item of paraImportar) {
              const detalhe = detalhePorArquivo.get(item.nomeArquivo);
              if (detalhe?.status === "ok") {
                atualizacoes.push({ id: item.documento.id, status: "importada" });
                totais.importadas++;
              } else {
                const motivo = detalhe?.motivo || "Não foi possível salvar a NF-e no Arquivo Fiscal e no histórico.";
                atualizacoes.push({ id: item.documento.id, status: "falha", erro: motivo.slice(0, 500) });
                totais.falhas++;
              }
            }
          } catch (e) {
            for (const item of paraImportar) {
              atualizacoes.push({ id: item.documento.id, status: "falha", erro: mensagem(e).slice(0, 500) });
              totais.falhas++;
            }
          }
        }
        if (atualizacoes.length) await marcarDocumentosDfe({ data: { items: atualizacoes } });
        if (exibirProgresso) {
          setAviso(`Processadas ${totais.importadas} NF-e até agora${totais.falhas ? ` · ${totais.falhas} com falha` : ""}.`);
        }
      }
      await atualizarDocumentos(alvo);
      return totais;
    } finally {
      filasAtivas.current.delete(alvo);
    }
  }, [atualizarDocumentos]);

  useEffect(() => { atualizarEmpresas().catch(e => setErro(mensagem(e))); }, [atualizarEmpresas]);
  useEffect(() => {
    if (!selecionado) { atualizarDocumentos(""); return; }
    let ativo = true;
    setErro("");
    setPagina(0);
    (async () => {
      const resultado = await atualizarDocumentos(selecionado, 0);
      await processarPendentes(selecionado);
      const empresa = empresas.find(item => item.cnpj === selecionado);
      const lotePendente = existeLoteDfePendente(resultado.cursor);
      const proximaBuscaMs = Math.max(
        resultado.cursor?.bloqueado_ate ? new Date(resultado.cursor.bloqueado_ate).getTime() : 0,
        !lotePendente && resultado.cursor?.consultado_em ? new Date(resultado.cursor.consultado_em).getTime() + INTERVALO_MINIMO_BUSCA_DFE_MS : 0,
      );
      const aguardando = proximaBuscaMs > Date.now();
      if (empresa?.busca_xml_automatica && !aguardando) {
        setAviso("Buscando novos XMLs automaticamente para esta empresa…");
        const busca = await consultarDfe({ data: { cnpj: selecionado } });
        const totais = await processarPendentes(selecionado, true);
        await atualizarDocumentos(selecionado, 0);
        if (ativo) setAviso(`Busca automática concluída. ${totais.importadas} NF-e interestadual(is) importada(s) para cálculo; ${totais.internas} NF-e da mesma UF arquivada(s). ${busca.descartados || 0} documento(s) fora do filtro foram descartados.`);
      } else if (empresa?.busca_xml_automatica && aguardando) {
        setAviso(`Próxima busca automática após ${new Date(proximaBuscaMs).toLocaleString("pt-BR")}.`);
      }
    })().catch(e => { if (ativo) setErro(mensagem(e)); });
    return () => { ativo = false; };
  }, [selecionado, competencia, empresas, atualizarDocumentos, processarPendentes]);

  useEffect(() => {
    if (!selecionado) return;
    const timer = window.setInterval(async () => {
      try {
        await processarPendentes(selecionado);
        await atualizarDocumentos(selecionado);
      } catch (e) { setErro(mensagem(e)); }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [selecionado, processarPendentes, atualizarDocumentos]);

  const documentosPorPasta = useMemo(() => {
    const anos = new Map();
    const ordenados = [...documentos].sort((a, b) => String(b.data_emissao || "").localeCompare(String(a.data_emissao || "")) || String(b.nsu).localeCompare(String(a.nsu)));
    ordenados.forEach(documento => {
      const pasta = pastaDataEmissao(documento.data_emissao);
      if (!anos.has(pasta.ano)) anos.set(pasta.ano, new Map());
      const meses = anos.get(pasta.ano);
      if (!meses.has(pasta.chave)) meses.set(pasta.chave, []);
      meses.get(pasta.chave).push(documento);
    });
    return [...anos.entries()].map(([ano, meses]) => [ano, [...meses.entries()]]);
  }, [documentos]);

  const tentarNovamente = async documento => {
    setOcupado(documento.id); setErro("");
    try {
      await marcarDocumentosDfe({ data: { items: [{ id: documento.id, status: "pendente" }] } });
      await processarPendentes(selecionado, true);
      await atualizarDocumentos(selecionado);
    } catch (e) { setErro(mensagem(e)); }
    finally { setOcupado(""); }
  };

  const obterXml = async documento => {
    setOcupado(documento.id); setErro(""); setAviso("");
    try {
      const resultado = await baixarDocumentoDfe({ data: { id: documento.id } });
      const url = URL.createObjectURL(new Blob([resultado.xml], { type: "application/xml" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${documento.chave_acesso || documento.numero_nfe || documento.nsu}.xml`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErro(mensagem(e)); }
    finally { setOcupado(""); }
  };

  const buscarXmls = async () => {
    if (!selecionado || buscando || proximaBuscaAte > Date.now()) return;
    setBuscando(true); setErro(""); setAviso("Consultando novos XMLs na SEFAZ…");
    try {
      const busca = await consultarDfe({ data: { cnpj: selecionado } });
      const totais = await processarPendentes(selecionado, true);
      await atualizarDocumentos(selecionado, 0);
      setAviso(`Busca concluída (${busca.status}). ${busca.recebidos || 0} documento(s) recebido(s); ${totais.importadas} NF-e importada(s) para cálculo e ${totais.internas} arquivada(s) da mesma UF.`);
    } catch (e) {
      setAviso(""); setErro(mensagem(e));
      await atualizarDocumentos(selecionado, 0).catch(() => {});
    } finally { setBuscando(false); }
  };

  const bloqueadoAte = cursor?.bloqueado_ate ? new Date(cursor.bloqueado_ate).getTime() : 0;
  const lotePendente = existeLoteDfePendente(cursor);
  const intervaloAte = !lotePendente && cursor?.consultado_em ? new Date(cursor.consultado_em).getTime() + INTERVALO_MINIMO_BUSCA_DFE_MS : 0;
  const proximaBuscaAte = Math.max(bloqueadoAte, intervaloAte);
  const aguardarSefaz = proximaBuscaAte > horaAtual;
  const empresaSelecionada = empresas.find(empresa => empresa.cnpj === selecionado);
  const monitoramentoAtivo = empresaSelecionada?.ativa && empresaSelecionada?.busca_xml_automatica && empresaSelecionada?.certificado && new Date(empresaSelecionada.certificado.validade_fim).getTime() > horaAtual;

  const periodoFmt = data => data ? new Date(data).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Sem busca registrada";
  const stats = [
    ["NF-e localizadas", indicadores.total, "XMLs completos e resumos da SEFAZ", C.blue],
    ["Importadas para cálculo", indicadores.importadas, "Entradas de outras UFs", C.green],
    ["Da mesma UF", indicadores.internas, "Guardadas sem cálculo de ICMS", C.blue],
    ["Aguardando processamento", indicadores.pendentes, "Serão processadas ao abrir o FiscoAI", C.yellow],
    ["Resumos aguardando XML", indicadores.resumos, indicadores.falhasCiencia ? `${indicadores.falhasCiencia} Ciência(s) serão tentadas novamente automaticamente` : "Ciência da Emissão automática registrada quando elegível", C.yellow],
    ["Com falha", indicadores.falhas, "Exigem nova tentativa", C.yellow],
    ["Empresas monitoradas", indicadores.monitoradas, "Com certificado válido", C.green],
    ["Última busca", periodoFmt(indicadores.ultimaBusca), cursor?.ultimo_status || "Busca automática na nuvem", C.blue],
  ];

  return <div style={{ display: "grid", gap: 14 }}>
    {erro && <div role="alert" style={S.alert("error")}>{erro}</div>}
    {aviso && <div role="status" style={S.alert("success")}>{aviso}</div>}

    <div style={{ ...S.card, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, alignItems: "end" }}>
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={S.cardTitle}>Central de XMLs</div>
        <p style={{ color: C.muted, fontSize: 12, margin: "4px 0 0" }}>A busca roda automaticamente na nuvem, mesmo com seu computador desligado. XMLs completos de entrada das duas UFs ficam guardados; só notas de outra UF são importadas para cálculo de ICMS.</p>
      </div>
      <label style={{ fontSize: 12 }}>Empresa
        <select value={selecionado} onChange={e => setSelecionado(e.target.value)} style={{ ...S.inp, width: "100%" }} aria-label="Filtrar XMLs por empresa">
          <option value="">Selecione uma empresa</option>
          {empresas.filter(empresa => empresa.certificado).map(empresa => <option key={empresa.cnpj} value={empresa.cnpj}>{empresa.nome_fantasia || empresa.razao_social} — {empresa.cnpj}</option>)}
        </select>
      </label>
      <label style={{ fontSize: 12 }}>Competência de emissão
        <input type="month" value={competencia} onChange={e => { if (!e.target.value) return; setCompetencia(e.target.value); setPagina(0); setDocumentos([]); }} style={{ ...S.inp, width: "100%" }} />
      </label>
      <div role="status" style={{ color: `rgb(${aguardarSefaz ? C.yellow : monitoramentoAtivo ? C.green : C.yellow})`, fontSize: 12, fontWeight: 700, padding: "10px 0" }}>
        {lotePendente && !aguardarSefaz && monitoramentoAtivo ? "● Lotes pendentes da SEFAZ · a busca continuará em sequência" : aguardarSefaz ? `Próxima busca permitida após ${new Date(proximaBuscaAte).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. Intervalo de duas horas; bloqueios da SEFAZ também são respeitados.` : monitoramentoAtivo ? "● Monitoramento automático ativo · buscas a cada duas horas quando não houver lotes pendentes" : "Busca pausada: confira a empresa e a validade do certificado."}
      </div>
      <button type="button" onClick={buscarXmls} disabled={!selecionado || !empresaSelecionada?.certificado || new Date(empresaSelecionada.certificado.validade_fim).getTime() <= horaAtual || !empresaSelecionada?.ativa || buscando || aguardarSefaz} style={S.btn("primary")}>
        {buscando ? "Buscando XMLs…" : "Buscar XMLs agora"}
      </button>
      {!empresas.some(empresa => empresa.certificado) && <button type="button" onClick={() => onNavigate?.("empresas")} style={S.btn("primary")}>Cadastrar empresa e certificado</button>}
    </div>

    {selecionado && <div style={{ ...S.statsGrid, gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10 }}>
      {stats.map(([label, value, sub, cor]) => <div key={label} style={{ ...S.card, minHeight: 102, padding: "13px 15px" }}>
        <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
        <div style={{ color: `rgb(${cor})`, fontSize: label === "Última busca" ? 14 : 23, fontWeight: 800, marginTop: 7, overflowWrap: "anywhere" }}>{label === "Última busca" ? value : Number(value || 0).toLocaleString("pt-BR")}</div>
        <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>{sub}</div>
      </div>)}
    </div>}

    <div style={S.card}>
      <div style={S.cardTitle}>Notas da competência · {rotuloCompetencia(competencia)}</div>
      {!selecionado ? <div style={{ color: C.muted }}>Selecione uma empresa com certificado cadastrado.</div> : !documentos.length ? <div style={{ color: C.muted }}>Nenhuma NF-e ou resumo localizado nesta competência. A busca cobre os documentos ainda disponíveis na distribuição da SEFAZ.</div> : documentosPorPasta.map(([ano, meses]) => <section key={ano} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text, padding: "5px 0 9px" }}>📁 {ano}</div>
        {meses.map(([mes, itens]) => <div key={mes} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 7, marginTop: 5 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, padding: "2px 0 4px" }}>📂 {rotuloCompetencia(mes)} <span style={{ fontWeight: 400 }}>({itens.length})</span></div>
          {itens.map(doc => {
            const importada = doc.processamento_status === "importada";
            const interna = doc.processamento_status === "interna" || (doc.uf_origem && doc.uf_origem === doc.uf_destino);
            const falhou = doc.processamento_status === "falha";
            const resumo = String(doc.schema_xml || "").startsWith("resNFe");
            const cienciaFalhou = doc.processamento_status === "ciencia_erro";
            const cienciaPendente = doc.processamento_status === "ciencia_pendente";
            const cienciaEnviada = doc.processamento_status === "ciencia_enviada";
            const identificacao = doc.numero_nfe ? `NF-e ${doc.numero_nfe}${doc.serie_nfe ? ` · Série ${doc.serie_nfe}` : ""}` : resumo ? `Resumo da NF-e · ${doc.chave_acesso || `NSU ${doc.nsu}`}` : `NF-e · NSU ${doc.nsu}`;
            const status = importada ? "Importada para cálculo" : interna ? "XML guardado · mesma UF" : falhou ? "Precisa de nova tentativa" : cienciaFalhou ? "Ciência será tentada novamente" : cienciaPendente ? "Registrando Ciência da Emissão" : cienciaEnviada ? "Ciência enviada · aguardando XML completo" : doc.processamento_status === "descartada" ? "Não elegível para cálculo" : "Aguardando processamento";
            return <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <strong>{identificacao}</strong>{doc.emitente_nome ? ` · ${doc.emitente_nome}` : ""}
                <div style={{ fontSize: 11, color: C.muted }}>{doc.uf_origem && doc.uf_destino ? `${doc.uf_origem} → ${doc.uf_destino} · ` : ""}{dataBR(doc.data_emissao)}{doc.valor_total_xml ? ` · R$ ${Number(doc.valor_total_xml).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}</div>
                {falhou && <div style={{ fontSize: 11, color: "#fca5a5" }}>{doc.processamento_erro || "Falha ao processar."}</div>}
                {cienciaFalhou && <div style={{ fontSize: 11, color: "#fca5a5" }}>{doc.processamento_erro || "A Ciência da Emissão será tentada novamente automaticamente."}</div>}
                {cienciaEnviada && doc.ciencia_protocolo && <div style={{ fontSize: 11, color: C.muted }}>Protocolo da Ciência: {doc.ciencia_protocolo}</div>}
              </div>
              <div role="status" style={{ color: importada || interna ? `rgb(${C.green})` : falhou || cienciaFalhou ? "#fca5a5" : `rgb(${C.yellow})`, fontWeight: 700, fontSize: 12 }}>{status}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {falhou && <button disabled={!!ocupado} onClick={() => tentarNovamente(doc)} style={S.btn("ghost")}>Tentar novamente</button>}
                {!resumo && <button disabled={!!ocupado} onClick={() => obterXml(doc)} style={S.btn("ghost")}>Baixar XML</button>}
              </div>
            </div>;
          })}
        </div>)}
      </section>)}
      {temMais && <button disabled={!!ocupado} onClick={async () => { const proxima = pagina + 1; setPagina(proxima); try { await atualizarDocumentos(selecionado, proxima, true); } catch (e) { setErro(mensagem(e)); } }} style={{ ...S.btn("ghost"), width: "100%", justifyContent: "center" }}>Carregar XMLs anteriores</button>}
    </div>
  </div>;
}
