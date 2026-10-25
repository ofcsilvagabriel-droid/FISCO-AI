import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsearNFe } from "@/modules/xml/services/parsearNFe";
import { baixarDocumentoDfe, consultarDfe, listarDocumentosDfe, marcarDocumentosDfe } from "@/modules/dfe/services/distribuicaoDfe.functions";
import { excluirCertificadoDfe, listarCertificadosDfe, salvarCertificadoDfe } from "@/modules/dfe/services/certificados.functions";
import { listarEmpresasFisco } from "@/modules/empresas/empresas.functions";

const dataBR = valor => valor ? new Date(valor).toLocaleDateString("pt-BR") : "—";
const mensagem = erro => erro?.message || String(erro || "Falha inesperada.");
const limparCnpj = valor => String(valor || "").replace(/[^0-9a-z]/gi, "").toUpperCase();
const baseCnpj = valor => limparCnpj(valor).slice(0, 8);
const PAGE_SIZE = 100;
const diaBahia = valor => valor ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(valor)) : "";
const hojeBahia = () => diaBahia(new Date());
const pastaDataEmissao = valor => {
  const match = String(valor || "").match(/^(\d{4})-(0[1-9]|1[0-2])/);
  return match ? { ano: match[1], mes: match[2], chave: `${match[1]}-${match[2]}` } : { ano: "Sem competência", mes: "Sem competência", chave: "sem-competencia" };
};
const rotuloCompetencia = chave => chave === "sem-competencia" ? "Sem competência" : `${chave.slice(5, 7)}/${chave.slice(0, 4)}`;

function notaElegivel(nota, cnpjCertificado) {
  const emitente = limparCnpj(nota?.emitente_cnpj);
  const destinatario = limparCnpj(nota?.destinatario_cnpj);
  const origem = String(nota?.uf_origem || "").toUpperCase();
  const destino = String(nota?.uf_destino || "").toUpperCase();
  return String(nota?.modelo || "") === "55"
    && baseCnpj(destinatario) !== ""
    && baseCnpj(destinatario) === baseCnpj(cnpjCertificado)
    && emitente !== destinatario
    && /^[A-Z]{2}$/.test(origem)
    && /^[A-Z]{2}$/.test(destino)
    && origem !== destino;
}

export default function PainelDfe({ S, C, onImport }) {
  const [aba, setAba] = useState("notas");
  const [certificados, setCertificados] = useState([]);
  const [cnpj, setCnpj] = useState("");
  const [nome, setNome] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const [senha, setSenha] = useState("");
  const [selecionado, setSelecionado] = useState("");
  const [documentos, setDocumentos] = useState([]);
  const [pendentes, setPendentes] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [temMais, setTemMais] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [ocupado, setOcupado] = useState("");
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

  const atualizarCertificados = useCallback(async () => {
    const lista = await listarCertificadosDfe();
    setCertificados(lista);
    setSelecionado(atual => atual || lista[0]?.cnpj || "");
    return lista;
  }, []);

  const atualizarDocumentos = useCallback(async (alvo, paginaAlvo = 0, acrescentar = false) => {
    if (!alvo) { setDocumentos([]); setPendentes(0); setCursor(null); setTemMais(false); return { documentos: [], pendentes: [], cursor: null, temMais: false }; }
    const resultado = await listarDocumentosDfe({ data: { cnpj: alvo, offset: paginaAlvo * PAGE_SIZE } });
    setDocumentos(atual => {
      const base = acrescentar ? atual : [];
      const porId = new Map([...base, ...(resultado.documentos || [])].map(documento => [documento.id, documento]));
      return [...porId.values()];
    });
    setPendentes(resultado.pendentes?.length || 0);
    setCursor(resultado.cursor);
    setTemMais(!!resultado.temMais);
    return resultado;
  }, []);

  const processarPendentes = useCallback(async (alvo, exibirProgresso = false) => {
    if (!alvo || filasAtivas.current.has(alvo)) return { importadas: 0, descartadas: 0, falhas: 0 };
    filasAtivas.current.add(alvo);
    const totais = { importadas: 0, descartadas: 0, falhas: 0 };
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
            } else if (!notaElegivel(parsed.nota, alvo)) {
              atualizacoes.push({ id: documento.id, status: "descartada" });
              totais.descartadas++;
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

  useEffect(() => { atualizarCertificados().catch(e => setErro(mensagem(e))); }, [atualizarCertificados]);
  useEffect(() => {
    if (!selecionado) { atualizarDocumentos(""); return; }
    let ativo = true;
    setErro("");
    setPagina(0);
    (async () => {
      const resultado = await atualizarDocumentos(selecionado, 0);
      await processarPendentes(selecionado);
      const [cadastros] = await Promise.all([listarEmpresasFisco()]);
      const empresa = cadastros.find(item => item.cnpj === selecionado);
      const consultouHoje = diaBahia(resultado.cursor?.consultado_em) === hojeBahia();
      const aguardando = resultado.cursor?.bloqueado_ate && new Date(resultado.cursor.bloqueado_ate).getTime() > Date.now();
      if (empresa?.busca_xml_automatica && !consultouHoje && !aguardando) {
        setAviso("Verificando novas NF-e automaticamente para esta empresa…");
        const busca = await consultarDfe({ data: { cnpj: selecionado } });
        const totais = await processarPendentes(selecionado, true);
        await atualizarDocumentos(selecionado, 0);
        if (ativo) setAviso(`Busca automática concluída. ${totais.importadas} NF-e importada(s) e salva(s). ${busca.descartados || 0} documento(s) fora do filtro foram descartados.`);
      }
    })().catch(e => { if (ativo) setErro(mensagem(e)); });
    return () => { ativo = false; };
  }, [selecionado, atualizarDocumentos, processarPendentes]);

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

  const enviarCertificado = async evento => {
    evento.preventDefault();
    const form = evento.currentTarget;
    if (!arquivo || arquivo.size > 65536) { setErro("Selecione um certificado A1 PFX/P12 de até 64 KB."); return; }
    setOcupado("certificado"); setErro(""); setAviso("");
    try {
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      let binario = "";
      for (const byte of bytes) binario += String.fromCharCode(byte);
      await salvarCertificadoDfe({ data: { cnpj: cnpj.replace(/\D/g, ""), nome, pfxBase64: btoa(binario), senha } });
      setArquivo(null); setSenha(""); setNome(""); setCnpj(""); form.reset();
      await atualizarCertificados();
      setAviso("Certificado cadastrado. A senha não fica salva no navegador.");
    } catch (e) { setErro(mensagem(e)); }
    finally { setOcupado(""); }
  };

  const consultar = async () => {
    if (!selecionado) return;
    setOcupado("consulta"); setErro(""); setAviso("");
    let lotes = 0;
    let ultimoNsu = cursor?.ult_nsu || null;
    const totais = { importadas: 0, descartadas: 0, falhas: 0 };
    try {
      while (true) {
        const resultado = await consultarDfe({ data: { cnpj: selecionado } });
        lotes++;
        const processadas = await processarPendentes(selecionado, true);
        totais.importadas += processadas.importadas;
        totais.descartadas += processadas.descartadas;
        totais.falhas += processadas.falhas;
        await atualizarDocumentos(selecionado);
        setAviso(`Busca em andamento · lote ${lotes} · ${totais.importadas} NF-e importada(s).`);
        if (resultado.cStat !== "138" || BigInt(resultado.ultNsu || "0") >= BigInt(resultado.maxNsu || "0")) break;
        if (!resultado.ultNsu || resultado.ultNsu === ultimoNsu) {
          throw new Error("A busca foi pausada porque a SEFAZ não avançou o NSU. O que já foi recebido continua salvo.");
        }
        ultimoNsu = resultado.ultNsu;
      }
      await atualizarDocumentos(selecionado);
      const detalheFalhas = totais.falhas ? ` ${totais.falhas} precisa(m) de nova tentativa.` : "";
      setAviso(`${lotes} lote(s) consultado(s). ${totais.importadas} NF-e importada(s) e salva(s) no histórico e no Arquivo Fiscal.${detalheFalhas}`);
    } catch (e) { setErro(mensagem(e)); }
    finally { setOcupado(""); }
  };

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

  const remover = async alvo => {
    if (!window.confirm(`Remover o certificado do CNPJ ${alvo}? Os XMLs já recebidos serão preservados.`)) return;
    setOcupado(alvo); setErro("");
    try {
      await excluirCertificadoDfe({ data: { cnpj: alvo } });
      setSelecionado(atual => atual === alvo ? "" : atual);
      await atualizarCertificados();
      setAviso("Certificado removido; XMLs recebidos preservados.");
    } catch (e) { setErro(mensagem(e)); }
    finally { setOcupado(""); }
  };

  const campo = { ...S.inp, width: "100%" };
  const tabStyle = ativo => ({ ...S.btn(ativo ? "primary" : "ghost"), minWidth: 170, justifyContent: "center" });
  const dataCursor = cursor?.consultado_em ? new Date(cursor.consultado_em).toLocaleString("pt-BR") : "Ainda não consultado";
  const bloqueadoAte = cursor?.bloqueado_ate ? new Date(cursor.bloqueado_ate).getTime() : 0;
  const aguardarSefaz = bloqueadoAte > horaAtual;

  return <div style={{ display: "grid", gap: 14 }}>
    <div style={{ ...S.card, padding: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => { setAba("notas"); setErro(""); }} style={tabStyle(aba === "notas")}>📥 NF-e de entrada</button>
        <button type="button" onClick={() => { setAba("certificados"); setErro(""); }} style={tabStyle(aba === "certificados")}>🔐 Certificados</button>
      </div>
    </div>

    {erro && <div role="alert" style={S.alert("error")}>{erro}</div>}
    {aviso && <div role="status" style={S.alert("success")}>{aviso}</div>}

    {aba === "certificados" ? <>
      <div style={S.card}>
        <div style={S.cardTitle}>Certificados digitais A1</div>
        <p style={{ color: C.muted, fontSize: 12 }}>Cadastre aqui o certificado usado para buscar NF-e. O arquivo e a senha são criptografados no servidor.</p>
        <form onSubmit={enviarCertificado} autoComplete="off" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
          <label style={{ fontSize: 12 }}>CNPJ autorizado<input required inputMode="numeric" value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="14 dígitos" style={campo}/></label>
          <label style={{ fontSize: 12 }}>Identificação<input required name="fiscoai-certificado-identificacao" autoComplete="off" value={nome} onChange={e => setNome(e.target.value)} placeholder="Empresa / filial" style={campo}/></label>
          <label style={{ fontSize: 12 }}>Certificado A1 (.pfx/.p12)<input required type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] || null)} style={campo}/></label>
          <label style={{ fontSize: 12 }}>Senha do certificado<input required name="fiscoai-certificado-a1-senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="new-password" style={campo}/></label>
          <button disabled={!!ocupado} type="submit" style={S.btn("primary")}>{ocupado === "certificado" ? "Salvando…" : "Salvar certificado"}</button>
        </form>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Validade</div>
        {!certificados.length ? <p style={{ color: C.muted }}>Nenhum certificado cadastrado.</p> : certificados.map(cert => {
          const dias = Math.ceil((new Date(cert.validade_fim).getTime() - Date.now()) / 86400000);
          const alerta = dias <= 0 ? "Vencido" : dias <= 30 ? `Vence em ${dias} dia(s)` : dias <= 60 ? `Atenção: ${dias} dias` : "Válido";
          return <div key={cert.cnpj} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
            <div><strong>{cert.nome}</strong> · {cert.cnpj}<div style={{ fontSize: 11, color: C.muted }}>{cert.titular} · até {dataBR(cert.validade_fim)}</div></div>
            <div role="status" style={{ color: dias <= 30 ? "#ffbd47" : "#34d399", fontWeight: 700 }}>{alerta}</div>
            <button disabled={!!ocupado} onClick={() => remover(cert.cnpj)} style={S.btn("ghost")}>Remover</button>
          </div>;
        })}
      </div>
    </> : <>
      <div style={S.card}>
        <div style={S.cardTitle}>Buscar NF-e de entrada</div>
        <p style={{ color: C.muted, fontSize: 12 }}>A busca importa automaticamente XMLs completos destinados à empresa do certificado, quando o fornecedor está em outra UF. Resumos e outros documentos não são guardados.</p>
        {!certificados.length && <p style={{ color: C.muted, fontSize: 12 }}>Cadastre um certificado na aba <strong>Certificados</strong> para começar.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto", gap: 8, alignItems: "end" }}>
          <label style={{ fontSize: 12 }}>Empresa
            <select value={selecionado} onChange={e => setSelecionado(e.target.value)} style={campo} aria-label="Empresa para buscar NF-e">
              <option value="">Selecione uma empresa</option>
              {certificados.map(cert => <option key={cert.cnpj} value={cert.cnpj}>{cert.nome} — {cert.cnpj}</option>)}
            </select>
          </label>
          <button disabled={!selecionado || !!ocupado || aguardarSefaz} onClick={consultar} style={S.btn("primary")}>{ocupado === "consulta" ? "Buscando e importando…" : aguardarSefaz ? `Nova busca após ${new Date(bloqueadoAte).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Buscar e importar NF-e"}</button>
        </div>
        {cursor && <p style={{ color: C.muted, fontSize: 11, marginBottom: 0 }}>Última busca: {dataCursor} · {cursor.ultimo_status || "Nenhuma consulta realizada"}{pendentes ? ` · ${pendentes} pendente(s) em processamento` : ""}</p>}
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>NF-e recebidas</div>
        {!documentos.length ? <p style={{ color: C.muted }}>Nenhum XML completo de entrada de outra UF disponível.</p> : documentosPorPasta.map(([ano, meses]) => <section key={ano} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text, padding: "5px 0 9px" }}>📁 {ano}</div>
          {meses.map(([mes, itens]) => <div key={mes} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 7, marginTop: 5 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, padding: "2px 0 4px" }}>📂 {rotuloCompetencia(mes)} <span style={{ fontWeight: 400 }}>({itens.length})</span></div>
            {itens.map(doc => {
              const importada = doc.processamento_status === "importada";
              const falhou = doc.processamento_status === "falha";
              const identificacao = doc.numero_nfe ? `NF-e ${doc.numero_nfe}${doc.serie_nfe ? ` · Série ${doc.serie_nfe}` : ""}` : `NF-e · NSU ${doc.nsu}`;
              return <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <strong>{identificacao}</strong>{doc.emitente_nome ? ` · ${doc.emitente_nome}` : ""}
                  <div style={{ fontSize: 11, color: C.muted }}>{doc.uf_origem && doc.uf_destino ? `${doc.uf_origem} → ${doc.uf_destino} · ` : ""}{dataBR(doc.data_emissao)}{doc.valor_total_xml ? ` · R$ ${Number(doc.valor_total_xml).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}</div>
                  {falhou && <div style={{ fontSize: 11, color: "#fca5a5" }}>{doc.processamento_erro || "Falha ao processar."}</div>}
                </div>
                <div role="status" style={{ color: importada ? "#34d399" : falhou ? "#fca5a5" : "#ffbd47", fontWeight: 700, fontSize: 12 }}>
                  {importada ? "Importada e salva" : falhou ? "Precisa de nova tentativa" : "Processando"}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {falhou && <button disabled={!!ocupado} onClick={() => tentarNovamente(doc)} style={S.btn("ghost")}>Tentar novamente</button>}
                  <button disabled={!!ocupado} onClick={() => obterXml(doc)} style={S.btn("ghost")}>Baixar XML</button>
                </div>
              </div>;
            })}
          </div>)}
        </section>)}
        {temMais && <button disabled={!!ocupado} onClick={async () => { const proxima = pagina + 1; setPagina(proxima); try { await atualizarDocumentos(selecionado, proxima, true); } catch (e) { setErro(mensagem(e)); } }} style={{ ...S.btn("ghost"), width: "100%", justifyContent: "center" }}>Carregar notas anteriores</button>}
      </div>
    </>}
  </div>;
}
