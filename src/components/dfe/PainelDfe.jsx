import { useEffect, useState } from "react";
import { baixarDocumentoDfe, consultarDfe, listarDocumentosDfe } from "@/modules/dfe/services/distribuicaoDfe.functions";
import { excluirCertificadoDfe, listarCertificadosDfe, salvarCertificadoDfe } from "@/modules/dfe/services/certificados.functions";

const dataBR = valor => valor ? new Date(valor).toLocaleDateString("pt-BR") : "—";
const mensagem = erro => erro?.message || String(erro || "Falha inesperada.");

export default function PainelDfe({ S, C, onImport }) {
  const [certificados, setCertificados] = useState([]);
  const [cnpj, setCnpj] = useState("");
  const [nome, setNome] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const [senha, setSenha] = useState("");
  const [selecionado, setSelecionado] = useState("");
  const [documentos, setDocumentos] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");

  const atualizarCertificados = async () => {
    const lista = await listarCertificadosDfe();
    setCertificados(lista);
    setSelecionado(atual => atual || lista[0]?.cnpj || "");
  };
  const atualizarDocumentos = async alvo => {
    if (!alvo) { setDocumentos([]); setCursor(null); return; }
    const resultado = await listarDocumentosDfe({ data: { cnpj: alvo } });
    setDocumentos(resultado.documentos);
    setCursor(resultado.cursor);
  };

  useEffect(() => { atualizarCertificados().catch(e => setErro(mensagem(e))); }, []);
  useEffect(() => { atualizarDocumentos(selecionado).catch(e => setErro(mensagem(e))); }, [selecionado]);

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
      setArquivo(null); setSenha(""); setNome(""); setCnpj("");
      form.reset();
      await atualizarCertificados();
      setAviso("Certificado cadastrado. A senha não fica salva no navegador.");
    } catch (e) { setErro(mensagem(e)); }
    finally { setOcupado(""); }
  };

  const consultar = async () => {
    setOcupado("consulta"); setErro(""); setAviso("");
    try {
      const resultado = await consultarDfe({ data: { cnpj: selecionado } });
      await atualizarDocumentos(selecionado);
      setAviso(`${resultado.status}. ${resultado.recebidos} documento(s) recebido(s).`);
    } catch (e) { setErro(mensagem(e)); }
    finally { setOcupado(""); }
  };

  const obterXml = async (documento, importar) => {
    setOcupado(documento.id); setErro(""); setAviso("");
    try {
      const resultado = await baixarDocumentoDfe({ data: { id: documento.id } });
      if (importar) {
        const resumo = await onImport([{ name: `${documento.nsu}.xml`, text: async () => resultado.xml }]);
        setAviso(resumo?.ok ? "NF-e importada no Arquivo Fiscal." : "XML recebido, mas a importação falhou. Confira o detalhamento do lote.");
      } else {
        const url = URL.createObjectURL(new Blob([resultado.xml], { type: "application/xml" }));
        const link = document.createElement("a");
        link.href = url; link.download = `${documento.chave_acesso || documento.nsu}.xml`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
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
  return <div style={{ display: "grid", gap: 16 }}>
    <div style={S.card}>
      <div style={S.cardTitle}>🔐 Certificados digitais A1</div>
      <p style={{ color: C.muted, fontSize: 12 }}>Cadastre o certificado do CNPJ autorizado para consultar a Distribuição DF-e. O arquivo e a senha são criptografados no servidor; não são exibidos novamente.</p>
      {erro && <div role="alert" style={S.alert("error")}>{erro}</div>}
      {aviso && <div role="status" style={S.alert("success")}>{aviso}</div>}
      <form onSubmit={enviarCertificado} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 12 }}>CNPJ autorizado<input required inputMode="numeric" value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="14 dígitos" style={campo}/></label>
        <label style={{ fontSize: 12 }}>Identificação<input required value={nome} onChange={e => setNome(e.target.value)} placeholder="Empresa / filial" style={campo}/></label>
        <label style={{ fontSize: 12 }}>Certificado A1 (.pfx/.p12)<input required type="file" accept=".pfx,.p12" onChange={e => setArquivo(e.target.files?.[0] || null)} style={campo}/></label>
        <label style={{ fontSize: 12 }}>Senha do certificado<input required type="password" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="off" style={campo}/></label>
        <button disabled={!!ocupado} type="submit" style={S.btn("primary")}>{ocupado === "certificado" ? "Salvando…" : "Salvar certificado"}</button>
      </form>
      <p style={{ color: C.muted, fontSize: 11 }}>Antes de consultar, confirme que o CNPJ informado pertence à base do certificado. Não envie o PFX ou a senha pelo chat.</p>
    </div>

    <div style={S.card}>
      <div style={S.cardTitle}>📅 Validade e alertas</div>
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

    <div style={S.card}>
      <div style={S.cardTitle}>📥 Buscar XMLs na SEFAZ</div>
      <p style={{ color: C.muted, fontSize: 12 }}>Consulta manual por NSU. Resumos podem aparecer antes do XML completo; o FiscoAI não manifesta notas automaticamente.</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select value={selecionado} onChange={e => setSelecionado(e.target.value)} style={campo} aria-label="CNPJ para consulta">
          <option value="">Selecione um certificado</option>
          {certificados.map(cert => <option key={cert.cnpj} value={cert.cnpj}>{cert.nome} — {cert.cnpj}</option>)}
        </select>
        <button disabled={!selecionado || !!ocupado} onClick={consultar} style={S.btn("primary")}>{ocupado === "consulta" ? "Consultando…" : "Consultar novos documentos"}</button>
      </div>
      {cursor && <p style={{ color: C.muted, fontSize: 11 }}>Último NSU: {cursor.ult_nsu} · Máximo: {cursor.max_nsu} · Última consulta: {cursor.consultado_em ? new Date(cursor.consultado_em).toLocaleString("pt-BR") : "—"} · {cursor.ultimo_status || "Ainda não consultado"}</p>}
      {!documentos.length ? <p style={{ color: C.muted }}>Nenhum documento recebido ainda.</p> : documentos.map(doc => {
        const completo = /procNFe/i.test(doc.schema_xml);
        return <div key={doc.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
          <div><strong>{completo ? "XML completo" : "Resumo/evento"}</strong> · NSU {doc.nsu}<div style={{ fontSize: 11, color: C.muted }}>{doc.chave_acesso || doc.schema_xml} · recebido {dataBR(doc.recebido_em)}</div></div>
          <div style={{ display: "flex", gap: 6 }}><button disabled={!!ocupado} onClick={() => obterXml(doc, false)} style={S.btn("ghost")}>Baixar XML</button>{completo && <button disabled={!!ocupado} onClick={() => obterXml(doc, true)} style={S.btn("success")}>Importar no FiscoAI</button>}</div>
        </div>;
      })}
    </div>
  </div>;
}
