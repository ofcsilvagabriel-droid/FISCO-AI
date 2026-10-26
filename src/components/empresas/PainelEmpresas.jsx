import { useCallback, useEffect, useMemo, useState } from "react";
import { importarEmpresasFisco, listarEmpresasFisco, removerAcessoSefazEmpresa, salvarAcessoSefazEmpresa, salvarEmpresaFisco } from "@/modules/empresas/empresas.functions";
import { excluirCertificadoDfe, salvarCertificadoDfe } from "@/modules/dfe/services/certificados.functions";

const REGIMES = [["SN", "Simples Nacional"], ["LP", "Lucro Presumido"], ["LR", "Lucro Real"], ["MEI", "MEI"], ["OUTRO", "Outro"]];
const CNPJ_VAZIO = "";
const digitos = valor => String(valor || "").replace(/\D/g, "");
const formatarCnpj = valor => {
  const v = digitos(valor).slice(0, 14);
  if (v.length !== 14) return v;
  return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
};
const erroTexto = erro => erro?.message || String(erro || "Falha inesperada.");
const novoFormulario = () => ({ cnpj: CNPJ_VAZIO, razao_social: "", nome_fantasia: "", uf: "", inscricao_estadual: "", regime: "", ativa: true, busca_xml_automatica: true });

export default function PainelEmpresas({ S, C, arquivo = {}, historico = [], memoria = [], onNavigate }) {
  const [empresas, setEmpresas] = useState([]);
  const [totalEmpresas, setTotalEmpresas] = useState(null);
  const [selecionada, setSelecionada] = useState("");
  const [form, setForm] = useState(novoFormulario);
  const [nova, setNova] = useState(false);
  const [arquivoA1, setArquivoA1] = useState(null);
  const [senhaA1, setSenhaA1] = useState("");
  const [acesso, setAcesso] = useState({ sistema: "Portal SEFAZ", endereco_portal: "", usuario: "", senha: "", observacoes: "" });
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    const lista = await listarEmpresasFisco();
    setEmpresas(lista);
    setTotalEmpresas(lista.length);
    return lista;
  }, []);

  useEffect(() => { carregar().catch(e => setErro(erroTexto(e))); }, [carregar]);

  const empresa = useMemo(() => empresas.find(item => item.cnpj === selecionada) || null, [empresas, selecionada]);
  useEffect(() => {
    if (!empresa) return;
    setForm({
      cnpj: empresa.cnpj,
      razao_social: empresa.razao_social || "",
      nome_fantasia: empresa.nome_fantasia || "",
      uf: empresa.uf || "",
      inscricao_estadual: empresa.inscricao_estadual || "",
      regime: empresa.regime || "",
      ativa: empresa.ativa !== false,
      busca_xml_automatica: empresa.busca_xml_automatica !== false,
    });
    setAcesso({ sistema: empresa.acesso_sefaz?.sistema || "Portal SEFAZ", endereco_portal: empresa.acesso_sefaz?.endereco_portal || "", usuario: "", senha: "", observacoes: empresa.acesso_sefaz?.observacoes || "" });
    setArquivoA1(null); setSenhaA1(""); setNova(false);
  }, [empresa]);

  const iniciarNova = () => {
    setSelecionada(""); setForm(novoFormulario()); setAcesso({ sistema: "Portal SEFAZ", endereco_portal: "", usuario: "", senha: "", observacoes: "" });
    setArquivoA1(null); setSenhaA1(""); setNova(true); setErro(""); setAviso("");
  };

  const salvarEmpresa = async evento => {
    evento.preventDefault(); setOcupado("empresa"); setErro(""); setAviso("");
    try {
      const salva = await salvarEmpresaFisco({ data: { ...form, cnpj: digitos(form.cnpj), uf: form.uf || null, regime: form.regime || null } });
      await carregar(); setSelecionada(salva.cnpj); setNova(false); setAviso("Cadastro da empresa salvo.");
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const salvarAcesso = async evento => {
    evento.preventDefault(); if (!empresa) return;
    setOcupado("acesso"); setErro(""); setAviso("");
    try {
      await salvarAcessoSefazEmpresa({ data: { cnpj: empresa.cnpj, ...acesso } });
      await carregar(); setAcesso(atual => ({ ...atual, usuario: "", senha: "" }));
      setAviso("Acesso da SEFAZ protegido e vinculado à empresa.");
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const importarCadastro = async evento => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setOcupado("importacao"); setErro(""); setAviso("");
    try {
      const conteudo = JSON.parse(await arquivo.text());
      const registros = Array.isArray(conteudo) ? conteudo : conteudo.empresas;
      if (!Array.isArray(registros) || registros.length === 0 || registros.length > 100) {
        throw new Error("O arquivo deve conter de 1 a 100 empresas no formato JSON.");
      }
      const resultado = await importarEmpresasFisco({ data: { empresas: registros } });
      await carregar();
      setAviso(`${resultado.empresas_salvas} empresa(s) cadastrada(s); ${resultado.acessos_salvos} acesso(s) protegido(s); ${resultado.sem_acesso} sem credencial completa.`);
      if (resultado.erros.length) setErro(`${resultado.erros.length} registro(s) não foram concluídos. CNPJs: ${resultado.erros.map(item => formatarCnpj(item.cnpj)).join(", ")}`);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); evento.target.value = ""; }
  };

  const removerAcesso = async () => {
    if (!empresa || !window.confirm("Remover o acesso da SEFAZ desta empresa?")) return;
    setOcupado("acesso"); setErro("");
    try { await removerAcessoSefazEmpresa({ data: { cnpj: empresa.cnpj } }); await carregar(); setAviso("Acesso removido."); }
    catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const salvarA1 = async evento => {
    evento.preventDefault(); const formulario = evento.currentTarget; if (!empresa || !arquivoA1) return;
    if (arquivoA1.size > 65536) { setErro("Selecione um arquivo A1 de até 64 KB."); return; }
    setOcupado("certificado"); setErro(""); setAviso("");
    try {
      const bytes = new Uint8Array(await arquivoA1.arrayBuffer());
      let binario = ""; for (const byte of bytes) binario += String.fromCharCode(byte);
      await salvarCertificadoDfe({ data: { cnpj: empresa.cnpj, nome: empresa.nome_fantasia || empresa.razao_social, pfxBase64: btoa(binario), senha: senhaA1 } });
      setArquivoA1(null); setSenhaA1(""); formulario.reset(); await carregar(); setAviso("Certificado vinculado à empresa para a busca de XMLs.");
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const desvincularA1 = async () => {
    if (!empresa?.certificado || !window.confirm(`Remover o certificado vinculado a ${empresa.razao_social}?`)) return;
    setOcupado("certificado"); setErro("");
    try { await excluirCertificadoDfe({ data: { cnpj: empresa.cnpj } }); await carregar(); setAviso("Certificado removido. Os XMLs já recebidos foram preservados."); }
    catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const inputStyle = { ...S.inp, width: "100%" };
  const cadastroRegistros = Object.entries(arquivo || {}).map(([chave, item]) => ({ chave, ...item }));
  const contagemEmpresa = cnpj => ({
    arquivo: cadastroRegistros.find(item => digitos(item.cnpj) === cnpj)?.registros?.length || 0,
    historico: historico.filter(item => digitos(item?.nota?.destinatario_cnpj) === cnpj).length,
    memoria: memoria.filter(item => digitos(item?.empresa_id) === cnpj).length,
  });

  return <div style={{ display: "grid", gap: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div><div style={S.cardTitle}>Cadastro de empresas</div><div style={{ color: C.muted, fontSize: 12 }}>Um cadastro por CNPJ conecta notas, histórico, memória, certificados e obrigações.</div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={{ ...S.btn("ghost"), cursor: ocupado === "importacao" ? "wait" : "pointer", opacity: ocupado === "importacao" ? 0.65 : 1 }}>
          {ocupado === "importacao" ? "Importando…" : "Importar cadastro JSON"}
          <input type="file" accept=".json,application/json" disabled={!!ocupado} onChange={importarCadastro} style={{ display: "none" }}/>
        </label>
        <button onClick={iniciarNova} disabled={!!ocupado} style={S.btn("primary")}>＋ Nova empresa</button>
      </div>
    </div>
    {erro && <div role="alert" style={S.alert("error")}>{erro}</div>}
    {aviso && <div role="status" style={S.alert("success")}>{aviso}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(230px, 0.75fr) minmax(0, 1.6fr)", gap: 14, alignItems: "start" }}>
      <div style={S.card}>
        <div style={S.cardTitle}>Empresas ({totalEmpresas ?? empresas.length})</div>
        {!empresas.length && <p style={{ color: C.muted, fontSize: 12 }}>Cadastre a primeira empresa para começar.</p>}
        <div style={{ display: "grid", gap: 6, maxHeight: 560, overflowY: "auto" }}>
          {empresas.map(item => <button key={item.cnpj} type="button" onClick={() => { setSelecionada(item.cnpj); setNova(false); setErro(""); setAviso(""); }} style={{ ...S.histItem(selecionada === item.cnpj), textAlign: "left", cursor: "pointer" }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{item.razao_social}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{formatarCnpj(item.cnpj)} · {item.uf || "UF não informada"}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: item.ativa ? "#34d399" : C.muted }}>{item.ativa ? "Ativa" : "Inativa"}</span>
              {item.certificado && <span style={{ fontSize: 10, color: "#68d391" }}>A1 vinculado</span>}
              {item.acesso_sefaz && <span style={{ fontSize: 10, color: "#68b6ff" }}>Acesso SEFAZ</span>}
            </div>
          </button>)}
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        {(empresa || nova) ? <>
          <div style={S.card}>
            <div style={S.cardTitle}>{nova ? "Nova empresa" : "Dados cadastrais"}</div>
            <form onSubmit={salvarEmpresa} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
              <label style={{ fontSize: 12 }}>CNPJ<input required inputMode="numeric" maxLength={18} disabled={!nova} value={formatarCnpj(form.cnpj)} onChange={e => setForm(v => ({ ...v, cnpj: digitos(e.target.value) }))} placeholder="00.000.000/0000-00" style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Razão social<input required maxLength={180} value={form.razao_social} onChange={e => setForm(v => ({ ...v, razao_social: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Nome fantasia<input maxLength={180} value={form.nome_fantasia} onChange={e => setForm(v => ({ ...v, nome_fantasia: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>UF<input maxLength={2} value={form.uf} onChange={e => setForm(v => ({ ...v, uf: e.target.value.toUpperCase() }))} placeholder="UF" style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Inscrição estadual<input maxLength={32} value={form.inscricao_estadual} onChange={e => setForm(v => ({ ...v, inscricao_estadual: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Regime tributário<select value={form.regime} onChange={e => setForm(v => ({ ...v, regime: e.target.value }))} style={inputStyle}><option value="">Selecione</option>{REGIMES.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={form.ativa} onChange={e => setForm(v => ({ ...v, ativa: e.target.checked }))}/> Empresa ativa</label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}><input type="checkbox" checked={form.busca_xml_automatica} onChange={e => setForm(v => ({ ...v, busca_xml_automatica: e.target.checked }))}/> Buscar XML automaticamente</label>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                {nova && <button type="button" onClick={() => { setNova(false); setForm(novoFormulario()); }} style={S.btn("ghost")}>Cancelar</button>}
                <button disabled={ocupado === "empresa"} type="submit" style={S.btn("primary")}>{ocupado === "empresa" ? "Salvando…" : "Salvar empresa"}</button>
              </div>
            </form>
          </div>

          {empresa && <>
            <div style={S.card}>
              <div style={S.cardTitle}>Acesso ao portal da SEFAZ</div>
              <p style={{ color: C.muted, fontSize: 11, marginTop: -4 }}>As credenciais são criptografadas no servidor. Por segurança, o usuário e a senha salvos não são exibidos.</p>
              {empresa.acesso_sefaz && <div role="status" style={{ color: "#34d399", fontSize: 12, marginBottom: 10 }}>Acesso cadastrado · {empresa.acesso_sefaz.sistema} · atualizado em {new Date(empresa.acesso_sefaz.atualizado_em).toLocaleDateString("pt-BR")}</div>}
              <form onSubmit={salvarAcesso} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
                <label style={{ fontSize: 12 }}>Sistema<input required maxLength={120} value={acesso.sistema} onChange={e => setAcesso(v => ({ ...v, sistema: e.target.value }))} style={inputStyle}/></label>
                <label style={{ fontSize: 12 }}>Endereço do portal<input maxLength={500} value={acesso.endereco_portal} onChange={e => setAcesso(v => ({ ...v, endereco_portal: e.target.value }))} placeholder="https://…" style={inputStyle}/></label>
                <label style={{ fontSize: 12 }}>Usuário{empresa.acesso_sefaz && <small style={{ color: C.muted }}> · preencha para substituir</small>}<input autoComplete="off" value={acesso.usuario} onChange={e => setAcesso(v => ({ ...v, usuario: e.target.value }))} style={inputStyle}/></label>
                <label style={{ fontSize: 12 }}>Senha{empresa.acesso_sefaz && <small style={{ color: C.muted }}> · preencha para substituir</small>}<input type="password" autoComplete="new-password" value={acesso.senha} onChange={e => setAcesso(v => ({ ...v, senha: e.target.value }))} style={inputStyle}/></label>
                <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>Observações<input maxLength={2000} value={acesso.observacoes} onChange={e => setAcesso(v => ({ ...v, observacoes: e.target.value }))} style={inputStyle}/></label>
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  {empresa.acesso_sefaz && <button type="button" disabled={!!ocupado} onClick={removerAcesso} style={S.btn("ghost")}>Remover acesso</button>}
                  <button disabled={ocupado === "acesso"} type="submit" style={S.btn("primary")}>{ocupado === "acesso" ? "Protegendo…" : empresa.acesso_sefaz ? "Atualizar acesso" : "Salvar acesso"}</button>
                </div>
              </form>
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}>Certificado digital A1</div>
              {empresa.certificado ? <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div><strong>{empresa.certificado.titular || empresa.certificado.nome}</strong><div style={{ color: C.muted, fontSize: 11 }}>Válido até {new Date(empresa.certificado.validade_fim).toLocaleDateString("pt-BR")}</div></div>
                <button disabled={!!ocupado} onClick={desvincularA1} style={S.btn("ghost")}>Remover certificado</button>
              </div> : <form onSubmit={salvarA1} autoComplete="off" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
                <label style={{ fontSize: 12 }}>Arquivo A1 (.pfx/.p12)<input required type="file" accept=".pfx,.p12" onChange={e => setArquivoA1(e.target.files?.[0] || null)} style={inputStyle}/></label>
                <label style={{ fontSize: 12 }}>Senha do certificado<input required type="password" autoComplete="new-password" value={senhaA1} onChange={e => setSenhaA1(e.target.value)} style={inputStyle}/></label>
                <button disabled={ocupado === "certificado"} type="submit" style={S.btn("primary")}>{ocupado === "certificado" ? "Salvando…" : "Vincular certificado"}</button>
              </form>}
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}>Dados vinculados pelo CNPJ</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
                {Object.entries(contagemEmpresa(empresa.cnpj)).map(([rotulo, total]) => <div key={rotulo} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "9px 12px" }}><div style={{ fontSize: 10, color: C.muted }}>{rotulo === "arquivo" ? "NF-e no Arquivo Fiscal" : rotulo === "historico" ? "Notas no Histórico" : "Decisões na Memória Protegida"}</div><div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginTop: 3 }}>{total}</div></div>)}
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                {[["arquivo", "Arquivo Fiscal"], ["historico", "Histórico"], ["obsidian", "Memória Protegida"], ["dfe", "NF-e e certificados"]].map(([tab, label]) => <button key={tab} onClick={() => onNavigate?.(tab)} style={S.btn("ghost")}>{label}</button>)}
              </div>
            </div>
          </>}
        </> : <div style={{ ...S.card, textAlign: "center", padding: "48px 20px", color: C.muted }}><div style={{ fontSize: 30, marginBottom: 10 }}>🏢</div><div>Selecione uma empresa ou cadastre uma nova.</div></div>}
      </div>
    </div>
  </div>;
}
