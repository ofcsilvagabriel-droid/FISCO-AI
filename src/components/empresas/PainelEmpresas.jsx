import { useCallback, useEffect, useMemo, useState } from "react";
import { configurarIntegracaoXmlEmpresa, importarEmpresasFisco, listarEmpresasFisco, obterPainelEmpresa, removerAcessoSefazEmpresa, revelarAcessoSefazEmpresa, salvarAcessoSefazEmpresa, salvarEmpresaFisco } from "@/modules/empresas/empresas.functions";
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
const novoFormulario = () => ({
  cnpj: CNPJ_VAZIO, razao_social: "", nome_fantasia: "", uf: "", inscricao_estadual: "", regime: "",
  situacao: "ATIVA", tipo_estabelecimento: "MATRIZ", matriz_empresa_id: null, codigo_interno: "", responsavel_nome: "", cnae_principal: "", email: "", telefone: "",
  cep: "", municipio: "", bairro: "", logradouro: "", numero: "", complemento: "", ativa: true,
  busca_xml_automatica: false,
});

export default function PainelEmpresas({ S, C, arquivo = {}, historico = [], memoria = [], onNavigate, onEmpresasChange, empresaInicial = "" }) {
  const [empresas, setEmpresas] = useState([]);
  const [selecionada, setSelecionada] = useState("");
  const [form, setForm] = useState(novoFormulario);
  const [nova, setNova] = useState(false);
  const [arquivoA1, setArquivoA1] = useState(null);
  const [senhaA1, setSenhaA1] = useState("");
  const [acesso, setAcesso] = useState({ sistema: "Portal SEFAZ", endereco_portal: "", usuario: "", senha: "", observacoes: "" });
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [acessoRevelado, setAcessoRevelado] = useState(null);
  const [revelandoAcesso, setRevelandoAcesso] = useState(false);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState("visao");
  const [painel, setPainel] = useState({ documentos: [], auditoria: [], integracao: null, membros: [], filiais: [], indicadores: {} });

  const carregar = useCallback(async () => {
    const lista = await listarEmpresasFisco();
    setEmpresas(lista);
    onEmpresasChange?.(lista);
    return lista;
  }, [onEmpresasChange]);

  useEffect(() => { carregar().catch(e => setErro(erroTexto(e))); }, [carregar]);
  useEffect(() => { if (empresaInicial) setSelecionada(empresaInicial); }, [empresaInicial]);

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
      situacao: empresa.situacao || "ATIVA",
      tipo_estabelecimento: empresa.tipo_estabelecimento || "MATRIZ",
      matriz_empresa_id: empresa.matriz_empresa_id || null,
      codigo_interno: empresa.codigo_interno || "",
      responsavel_nome: empresa.responsavel_nome || "",
      cnae_principal: empresa.cnae_principal || "",
      email: empresa.email || "",
      telefone: empresa.telefone || "",
      cep: empresa.cep || "",
      municipio: empresa.municipio || "",
      bairro: empresa.bairro || "",
      logradouro: empresa.logradouro || "",
      numero: empresa.numero || "",
      complemento: empresa.complemento || "",
      ativa: empresa.ativa !== false,
      busca_xml_automatica: false,
    });
    setAcesso({ sistema: empresa.acesso_sefaz?.sistema || "Portal SEFAZ", endereco_portal: empresa.acesso_sefaz?.endereco_portal || "", usuario: "", senha: "", observacoes: empresa.acesso_sefaz?.observacoes || "" });
    setAcessoRevelado(null);
    setArquivoA1(null); setSenhaA1(""); setNova(false); setAba("visao");
    obterPainelEmpresa({ data: { cnpj: empresa.cnpj } }).then(setPainel).catch(e => setErro(erroTexto(e)));
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
      setAcessoRevelado(null);
      setAviso("Acesso da SEFAZ protegido e vinculado à empresa.");
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const revelarAcesso = async () => {
    if (!empresa) return;
    if (acessoRevelado) { setAcessoRevelado(null); return; }
    setRevelandoAcesso(true); setErro("");
    try { setAcessoRevelado(await revelarAcessoSefazEmpresa({ data: { cnpj: empresa.cnpj } })); }
    catch (e) { setErro(erroTexto(e)); }
    finally { setRevelandoAcesso(false); }
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
      setArquivoA1(null); setSenhaA1(""); formulario.reset(); await carregar(); setAviso("Certificado vinculado ao cadastro fiscal da empresa.");
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

  const configurarIntegracao = async habilitada => {
    if (!empresa) return;
    setOcupado("integracao"); setErro(""); setAviso("");
    try {
      await configurarIntegracaoXmlEmpresa({ data: { cnpj: empresa.cnpj, habilitada } });
      setPainel(await obterPainelEmpresa({ data: { cnpj: empresa.cnpj } }));
      setAviso(habilitada ? "Integração preparada; falta conectar um worker autorizado." : "Integração de recuperação desativada.");
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const inputStyle = { ...S.inp, width: "100%" };
  const cadastroRegistros = Object.entries(arquivo || {}).map(([chave, item]) => ({ chave, ...item }));
  const contagemEmpresa = cnpj => ({
    arquivo: cadastroRegistros.find(item => digitos(item.cnpj) === cnpj)?.registros?.length || 0,
    historico: historico.filter(item => digitos(item?.nota?.destinatario_cnpj) === cnpj).length,
    memoria: memoria.filter(item => digitos(item?.empresa_id) === cnpj).length,
  });
  const empresasFiltradas = empresas.filter(item => {
    const termo = busca.trim().toLowerCase();
    return !termo || [item.razao_social, item.nome_fantasia, item.cnpj, item.inscricao_estadual].some(valor => String(valor || "").toLowerCase().includes(termo));
  });
  const listaEmpresas = empresasFiltradas.map(item => <button key={item.cnpj} type="button" onClick={() => { setSelecionada(item.cnpj); setNova(false); setErro(""); setAviso(""); }} style={{ ...S.histItem(selecionada === item.cnpj), textAlign: "left", cursor: "pointer" }}>
    <div style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{item.razao_social}</div>
    <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{formatarCnpj(item.cnpj)} · {item.uf || "UF não informada"}</div>
    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, color: item.situacao === "ATIVA" ? "#34d399" : C.muted }}>{item.situacao === "ATIVA" ? "Ativa" : item.situacao}</span>
      <span style={{ fontSize: 10, color: C.muted }}>{item.tipo_estabelecimento === "FILIAL" ? "Filial" : "Matriz"}</span>
      {item.certificado && <span style={{ fontSize: 10, color: "#68d391" }}>A1 vinculado</span>}
      {item.acesso_sefaz && <span style={{ fontSize: 10, color: "#68b6ff" }}>Acesso SEFAZ</span>}
    </div>
  </button>);

  return <div style={{ display: "grid", gap: 14 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div><div style={{ ...S.cardTitle, fontSize: 18 }}>Empresas</div><div style={{ color: C.muted, fontSize: 12 }}>Cadastro mestre para documentos, regras fiscais, certificados, acessos e auditoria.</div></div>
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(320px,100%),1fr))", gap: 14, alignItems: "start" }}>
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}><div style={S.cardTitle}>Empresas</div><span style={{ color: C.muted, fontSize: 12 }}>{empresasFiltradas.length} de {empresas.length}</span></div>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome, CNPJ ou inscrição" aria-label="Buscar empresas" style={{ ...S.inp, width: "100%", marginBottom: 10 }}/>
        {!empresas.length && <p style={{ color: C.muted, fontSize: 12 }}>Cadastre a primeira empresa para começar.</p>}
        {!!empresas.length && !listaEmpresas.length && <p style={{ color: C.muted, fontSize: 12 }}>Nenhuma empresa corresponde aos filtros.</p>}
        <div style={{ display: "grid", gap: 6, maxHeight: 560, overflowY: "auto" }}>
          {listaEmpresas}
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        {(empresa || nova) ? <>
          {empresa && <div style={{ ...S.card, display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{empresa.razao_social}</div><div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{empresa.nome_fantasia || "Sem nome fantasia"} · {formatarCnpj(empresa.cnpj)} · {empresa.uf || "UF não informada"}</div></div>
              <span style={{ color: empresa.situacao === "ATIVA" ? "#34d399" : C.muted, fontSize: 12, fontWeight: 700 }}>{empresa.situacao || "ATIVA"}</span>
            </div>
            <div role="tablist" aria-label="Seções da empresa" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["visao", "Visão geral"], ["cadastro", "Cadastro"], ["fiscal", "Fiscal"], ["certificados", "Certificados"], ["acessos", "Acessos"], ["documentos", "Documentos"], ["integracoes", "Integrações"], ["equipe", "Equipe"], ["auditoria", "Auditoria"]].map(([id, rotulo]) => <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)} style={aba === id ? S.btn("primary") : S.btn("ghost")}>{rotulo}</button>)}
            </div>
          </div>}

          {(nova || aba === "cadastro") && <div style={S.card}>
            <div style={S.cardTitle}>{nova ? "Nova empresa" : "Dados cadastrais"}</div>
            <form onSubmit={salvarEmpresa} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
              <label style={{ fontSize: 12 }}>CNPJ<input required inputMode="numeric" maxLength={18} disabled={!nova} value={formatarCnpj(form.cnpj)} onChange={e => setForm(v => ({ ...v, cnpj: digitos(e.target.value) }))} placeholder="00.000.000/0000-00" style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Razão social<input required maxLength={180} value={form.razao_social} onChange={e => setForm(v => ({ ...v, razao_social: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Nome fantasia<input maxLength={180} value={form.nome_fantasia} onChange={e => setForm(v => ({ ...v, nome_fantasia: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Situação<select value={form.situacao} onChange={e => setForm(v => ({ ...v, situacao: e.target.value, ativa: e.target.value === "ATIVA" }))} style={inputStyle}><option value="ATIVA">Ativa</option><option value="INATIVA">Inativa</option><option value="SUSPENSA">Suspensa</option><option value="BAIXADA">Baixada</option></select></label>
              <label style={{ fontSize: 12 }}>Estabelecimento<select value={form.tipo_estabelecimento} onChange={e => setForm(v => ({ ...v, tipo_estabelecimento: e.target.value }))} style={inputStyle}><option value="MATRIZ">Matriz</option><option value="FILIAL">Filial</option></select></label>
              {form.tipo_estabelecimento === "FILIAL" && <label style={{ fontSize: 12 }}>Matriz<select required value={form.matriz_empresa_id || ""} onChange={e => setForm(v => ({ ...v, matriz_empresa_id: e.target.value || null }))} style={inputStyle}><option value="">Selecione</option>{empresas.filter(item => item.tipo_estabelecimento === "MATRIZ" && item.cnpj !== form.cnpj).map(item => <option key={item.empresa_id} value={item.empresa_id}>{item.razao_social}</option>)}</select></label>}
              <label style={{ fontSize: 12 }}>Código interno<input maxLength={40} value={form.codigo_interno} onChange={e => setForm(v => ({ ...v, codigo_interno: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Responsável<input maxLength={180} value={form.responsavel_nome} onChange={e => setForm(v => ({ ...v, responsavel_nome: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>UF<input maxLength={2} value={form.uf} onChange={e => setForm(v => ({ ...v, uf: e.target.value.toUpperCase() }))} placeholder="UF" style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Inscrição estadual<input maxLength={32} value={form.inscricao_estadual} onChange={e => setForm(v => ({ ...v, inscricao_estadual: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>E-mail<input type="email" maxLength={240} value={form.email} onChange={e => setForm(v => ({ ...v, email: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Telefone<input maxLength={32} value={form.telefone} onChange={e => setForm(v => ({ ...v, telefone: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>CEP<input maxLength={9} value={form.cep} onChange={e => setForm(v => ({ ...v, cep: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Município<input maxLength={120} value={form.municipio} onChange={e => setForm(v => ({ ...v, municipio: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Bairro<input maxLength={120} value={form.bairro} onChange={e => setForm(v => ({ ...v, bairro: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>Logradouro<input maxLength={240} value={form.logradouro} onChange={e => setForm(v => ({ ...v, logradouro: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Número<input maxLength={32} value={form.numero} onChange={e => setForm(v => ({ ...v, numero: e.target.value }))} style={inputStyle}/></label>
              <label style={{ fontSize: 12 }}>Complemento<input maxLength={120} value={form.complemento} onChange={e => setForm(v => ({ ...v, complemento: e.target.value }))} style={inputStyle}/></label>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                {nova && <button type="button" onClick={() => { setNova(false); setForm(novoFormulario()); }} style={S.btn("ghost")}>Cancelar</button>}
                <button disabled={ocupado === "empresa"} type="submit" style={S.btn("primary")}>{ocupado === "empresa" ? "Salvando…" : "Salvar empresa"}</button>
              </div>
            </form>
          </div>}

          {empresa && <>
            {aba === "fiscal" && <div style={S.card}>
              <div style={S.cardTitle}>Configuração fiscal</div>
              <form onSubmit={salvarEmpresa} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
                <label style={{ fontSize: 12 }}>Regime tributário<select value={form.regime} onChange={e => setForm(v => ({ ...v, regime: e.target.value }))} style={inputStyle}><option value="">Selecione</option>{REGIMES.map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}</select></label>
                <label style={{ fontSize: 12 }}>CNAE principal<input maxLength={16} value={form.cnae_principal} onChange={e => setForm(v => ({ ...v, cnae_principal: e.target.value }))} placeholder="0000-0/00" style={inputStyle}/></label>
                <button disabled={ocupado === "empresa"} type="submit" style={S.btn("primary")}>{ocupado === "empresa" ? "Salvando…" : "Salvar configuração fiscal"}</button>
              </form>
            </div>}

            {aba === "acessos" && <div style={S.card}>
              <div style={S.cardTitle}>Acesso ao portal da SEFAZ</div>
              <p style={{ color: C.muted, fontSize: 11, marginTop: -4 }}>As credenciais ficam criptografadas. Revele-as somente quando precisar consultar este acesso.</p>
              {empresa.acesso_sefaz && <div role="status" style={{ color: "#34d399", fontSize: 12, marginBottom: 10 }}>Acesso cadastrado · {empresa.acesso_sefaz.sistema} · atualizado em {new Date(empresa.acesso_sefaz.atualizado_em).toLocaleDateString("pt-BR")}</div>}
              {empresa.acesso_sefaz && <div style={{ marginBottom: 10 }}>
                <button type="button" disabled={revelandoAcesso} onClick={revelarAcesso} style={S.btn("ghost")}>{revelandoAcesso ? "Carregando credenciais…" : acessoRevelado ? "Ocultar usuário e senha" : "Mostrar usuário e senha"}</button>
                {acessoRevelado && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginTop: 10 }}>
                  <label style={{ fontSize: 12 }}>Usuário<input readOnly value={acessoRevelado.usuario} style={inputStyle}/></label>
                  <label style={{ fontSize: 12 }}>Senha<input readOnly type="text" value={acessoRevelado.senha} style={inputStyle}/></label>
                </div>}
              </div>}
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
            </div>}

            {aba === "certificados" && <div style={S.card}>
              <div style={S.cardTitle}>Certificado digital A1</div>
              {empresa.certificado ? <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div><strong>{empresa.certificado.titular || empresa.certificado.nome}</strong><div style={{ color: C.muted, fontSize: 11 }}>Válido até {new Date(empresa.certificado.validade_fim).toLocaleDateString("pt-BR")}</div></div>
                <button disabled={!!ocupado} onClick={desvincularA1} style={S.btn("ghost")}>Remover certificado</button>
              </div> : <form onSubmit={salvarA1} autoComplete="off" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
                <label style={{ fontSize: 12 }}>Arquivo A1 (.pfx/.p12)<input required type="file" accept=".pfx,.p12" onChange={e => setArquivoA1(e.target.files?.[0] || null)} style={inputStyle}/></label>
                <label style={{ fontSize: 12 }}>Senha do certificado<input required type="password" autoComplete="new-password" value={senhaA1} onChange={e => setSenhaA1(e.target.value)} style={inputStyle}/></label>
                <button disabled={ocupado === "certificado"} type="submit" style={S.btn("primary")}>{ocupado === "certificado" ? "Salvando…" : "Vincular certificado"}</button>
              </form>}
            </div>}

            {aba === "documentos" && <div style={{ ...S.card, display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}><div><div style={S.cardTitle}>Documentos fiscais</div><div style={{ color: C.muted, fontSize: 11 }}>XMLs completos vinculados pelo CNPJ do destinatário.</div></div><button onClick={() => onNavigate?.("dfe", empresa.cnpj)} style={S.btn("primary")}>Abrir Central de Documentos</button></div>
              {!painel.documentos.length ? <div style={{ color: C.muted, padding: "18px 0" }}>Nenhum XML completo vinculado.</div> : <div style={{ display: "grid" }}>{painel.documentos.map(doc => <div key={doc.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}><div><strong>NF-e {doc.numero_nfe || "—"}</strong>{doc.emitente_nome ? ` · ${doc.emitente_nome}` : ""}<div style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>{doc.data_emissao ? new Date(doc.data_emissao).toLocaleDateString("pt-BR") : "Sem data"} · {doc.origem === "ACERVO_LEGADO" ? "Acervo anterior" : doc.origem === "API_PROPRIA" ? "API própria" : "Importação manual"}</div></div><span style={{ color: doc.processamento_status === "falha" ? "#fca5a5" : "#34d399", fontSize: 11, fontWeight: 700 }}>{doc.processamento_status}</span></div>)}</div>}
            </div>}

            {aba === "integracoes" && <div style={{ ...S.card, display: "grid", gap: 12 }}>
              <div><div style={S.cardTitle}>Recuperação de XML</div><div style={{ color: C.muted, fontSize: 11 }}>A API própria controla a fila; somente um worker autorizado poderá consultar o provedor externo.</div></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                {[["Status", painel.integracao?.status || "AGUARDANDO_CONFIGURACAO"], ["Provedor", painel.integracao?.provedor || "WORKER_AUTORIZADO"], ["Último sucesso", painel.integracao?.ultimo_sucesso_em ? new Date(painel.integracao.ultimo_sucesso_em).toLocaleString("pt-BR") : "Nunca"]].map(([rotulo, valor]) => <div key={rotulo} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "10px 12px" }}><div style={{ color: C.muted, fontSize: 10 }}>{rotulo}</div><div style={{ color: C.text, fontWeight: 700, fontSize: 12, marginTop: 4 }}>{valor}</div></div>)}
              </div>
              {painel.integracao?.ultimo_erro && <div role="alert" style={S.alert("error")}>{painel.integracao.ultimo_erro}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button disabled={ocupado === "integracao"} onClick={() => configurarIntegracao(painel.integracao?.status === "DESATIVADA")} style={painel.integracao?.status === "DESATIVADA" ? S.btn("primary") : S.btn("ghost")}>{ocupado === "integracao" ? "Salvando…" : painel.integracao?.status === "DESATIVADA" ? "Preparar integração" : "Desativar integração"}</button></div>
            </div>}

            {aba === "equipe" && <div style={{ ...S.card, display: "grid", gap: 12 }}>
              <div><div style={S.cardTitle}>Usuários e permissões</div><div style={{ color: C.muted, fontSize: 11 }}>Acesso segregado por empresa. Convites dependerão do serviço de identidade corporativa.</div></div>
              {painel.membros.map(membro => <div key={membro.membro_user_id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}><div><strong>{membro.papel === "PROPRIETARIO" ? "Proprietário da conta" : "Usuário vinculado"}</strong><div style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>{membro.email || membro.membro_user_id}</div></div><span style={{ color: membro.ativo ? "#34d399" : C.muted, fontSize: 11 }}>{membro.ativo ? "Ativo" : "Inativo"} · {membro.papel}</span></div>)}
            </div>}

            {aba === "auditoria" && <div style={{ ...S.card, display: "grid", gap: 10 }}>
              <div><div style={S.cardTitle}>Auditoria operacional</div><div style={{ color: C.muted, fontSize: 11 }}>Alterações cadastrais, importações e tentativas da API própria.</div></div>
              {!painel.auditoria.length ? <div style={{ color: C.muted, padding: "18px 0" }}>Nenhum evento registrado.</div> : painel.auditoria.map(evento => <div key={evento.id} style={{ display: "grid", gridTemplateColumns: "minmax(140px,0.6fr) minmax(200px,1fr) auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}><div><strong style={{ fontSize: 11 }}>{evento.operacao}</strong><div style={{ color: C.muted, fontSize: 9, marginTop: 3 }}>{new Date(evento.criado_em).toLocaleString("pt-BR")}</div></div><div style={{ color: C.muted, fontSize: 11 }}>{evento.mensagem || "—"}</div><span style={{ color: evento.status === "SUCESSO" ? "#34d399" : evento.status === "FALHA" ? "#fca5a5" : C.muted, fontSize: 10, fontWeight: 700 }}>{evento.status}</span></div>)}
            </div>}

            {aba === "visao" && <div style={S.card}>
              <div style={S.cardTitle}>Dados vinculados pelo CNPJ</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
                {Object.entries(contagemEmpresa(empresa.cnpj)).map(([rotulo, total]) => <div key={rotulo} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "9px 12px" }}><div style={{ fontSize: 10, color: C.muted }}>{rotulo === "arquivo" ? "NF-e no Arquivo Fiscal" : rotulo === "historico" ? "Notas no Histórico" : "Decisões na Memória Protegida"}</div><div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginTop: 3 }}>{total}</div></div>)}
                {[["XMLs recentes", painel.indicadores.documentos || 0], ["Fila pendente", painel.indicadores.pendentes || 0], ["Falhas da API", painel.indicadores.falhas || 0], ["Filiais", painel.filiais.length]].map(([rotulo, total]) => <div key={rotulo} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "9px 12px" }}><div style={{ fontSize: 10, color: C.muted }}>{rotulo}</div><div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginTop: 3 }}>{total}</div></div>)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, marginTop: 10 }}>
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "10px 12px" }}><div style={{ color: C.muted, fontSize: 10 }}>Certificado digital</div><div style={{ color: empresa.certificado && new Date(empresa.certificado.validade_fim).getTime() > Date.now() ? "#34d399" : "#fca5a5", fontSize: 12, fontWeight: 700, marginTop: 4 }}>{empresa.certificado ? `Válido até ${new Date(empresa.certificado.validade_fim).toLocaleDateString("pt-BR")}` : "Não cadastrado"}</div></div>
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 7, padding: "10px 12px" }}><div style={{ color: C.muted, fontSize: 10 }}>Integração de XML</div><div style={{ color: painel.integracao?.status === "ATIVA" ? "#34d399" : C.text, fontSize: 12, fontWeight: 700, marginTop: 4 }}>{painel.integracao?.status || "AGUARDANDO_CONFIGURACAO"}</div></div>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                {[["arquivo", "Arquivo Fiscal"], ["historico", "Histórico"], ["obsidian", "Memória Protegida"], ["dfe", "Docs Fiscais"]].map(([tab, label]) => <button key={tab} onClick={() => onNavigate?.(tab, empresa.cnpj)} style={S.btn("ghost")}>{label}</button>)}
              </div>
            </div>}
          </>}
        </> : <div style={{ ...S.card, textAlign: "center", padding: "48px 20px", color: C.muted }}><div style={{ fontSize: 30, marginBottom: 10 }}>🏢</div><div>Selecione uma empresa ou cadastre uma nova.</div></div>}
      </div>
    </div>
  </div>;
}
