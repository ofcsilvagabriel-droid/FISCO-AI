import { useCallback, useEffect, useMemo, useState } from "react";
import { listarEmpresasFisco } from "@/modules/empresas/empresas.functions";
import { listarObrigacoesIcms, prepararObrigacoesIcms, salvarObrigacaoIcms } from "@/modules/obrigacoes/obrigacoes.functions";

const ALERTA_VENCIMENTO_DIAS = 3;
const TIPOS = [
  ["ANTECIPACAO_PARCIAL", "Antecipação Parcial"],
  ["ANTECIPACAO_TRIBUTARIA", "Antecipação Tributária"],
  ["DIFAL", "DIFAL"],
];
const SITUACOES = [["PENDENTE", "Pendente"], ["ENVIADO", "Enviado"], ["SEM_MOVIMENTO", "Sem movimento"], ["NA_PASTA", "Na pasta"]];
const competenciaAtual = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
};
const dataLocal = () => {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
};
const digitos = valor => String(valor || "").replace(/\D/g, "");
const erroTexto = erro => erro?.message || String(erro || "Falha inesperada.");
const formatarCnpj = valor => digitos(valor).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const labelSituacao = valor => SITUACOES.find(([id]) => id === valor)?.[1] || valor;
const nomeTipo = valor => TIPOS.find(([id]) => id === valor)?.[1] || valor;

export default function PainelObrigacoes({ S, C }) {
  const [empresas, setEmpresas] = useState([]);
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [registros, setRegistros] = useState([]);
  const [rascunhos, setRascunhos] = useState({});
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState("");
  const [vencimentos, setVencimentos] = useState({ ANTECIPACAO_PARCIAL: "", ANTECIPACAO_TRIBUTARIA: "", DIFAL: "" });
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async (mes = competencia) => {
    const [listaEmpresas, listaObrigacoes] = await Promise.all([
      listarEmpresasFisco(),
      listarObrigacoesIcms({ data: { competencia: mes } }),
    ]);
    setEmpresas(listaEmpresas);
    setRegistros(listaObrigacoes);
    setRascunhos(Object.fromEntries(listaObrigacoes.map(item => [item.id, { ...item, valor_guia: item.valor_guia == null ? "" : String(item.valor_guia) }])));
    const padrao = Object.fromEntries(TIPOS.map(([tipo]) => [tipo, listaObrigacoes.find(item => item.tipo === tipo)?.vencimento || ""]));
    setVencimentos(padrao);
    return { listaEmpresas, listaObrigacoes };
  }, [competencia]);

  useEffect(() => { carregar().catch(e => setErro(erroTexto(e))); }, [carregar]);

  const empresaPorCnpj = useMemo(() => new Map(empresas.map(empresa => [empresa.cnpj, empresa])), [empresas]);
  const visiveis = useMemo(() => registros.filter(item =>
    (!filtroEmpresa || item.empresa_cnpj === filtroEmpresa) && (!filtroSituacao || item.status === filtroSituacao)
  ), [registros, filtroEmpresa, filtroSituacao]);
  const contagem = useMemo(() => {
    const hoje = dataLocal();
    const limite = new Date(`${hoje}T00:00:00`);
    limite.setDate(limite.getDate() + ALERTA_VENCIMENTO_DIAS);
    const ate = `${limite.getFullYear()}-${String(limite.getMonth() + 1).padStart(2, "0")}-${String(limite.getDate()).padStart(2, "0")}`;
    return {
      total: registros.length,
      enviados: registros.filter(item => item.status === "ENVIADO").length,
      semMovimento: registros.filter(item => item.status === "SEM_MOVIMENTO").length,
      pendentes: registros.filter(item => item.status === "PENDENTE").length,
      atrasados: registros.filter(item => item.status === "PENDENTE" && item.vencimento && item.vencimento < hoje).length,
      vencendo: registros.filter(item => item.status === "PENDENTE" && item.vencimento && item.vencimento >= hoje && item.vencimento <= ate).length,
    };
  }, [registros]);

  const preparar = async () => {
    setOcupado("preparar"); setErro(""); setAviso("");
    try {
      const resposta = await prepararObrigacoesIcms({ data: { competencia, vencimentos } });
      await carregar(competencia);
      setAviso(`${resposta.registros_preparados} controles verificados para ${resposta.empresas} empresa(s). Os meses anteriores foram preservados.`);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const atualizarRascunho = (id, campo, valor) => setRascunhos(atual => ({ ...atual, [id]: { ...atual[id], [campo]: valor } }));
  const salvar = async item => {
    const atual = rascunhos[item.id];
    setOcupado(item.id); setErro(""); setAviso("");
    try {
      const salvo = await salvarObrigacaoIcms({ data: {
        id: item.id,
        status: atual.status,
        vencimento: atual.vencimento || null,
        valor_guia: atual.valor_guia === "" ? null : Number(atual.valor_guia),
        data_envio: atual.data_envio || null,
        observacoes: atual.observacoes || null,
      } });
      setRegistros(lista => lista.map(registro => registro.id === salvo.id ? salvo : registro));
      setRascunhos(lista => ({ ...lista, [salvo.id]: { ...salvo, valor_guia: salvo.valor_guia == null ? "" : String(salvo.valor_guia) } }));
      setAviso(`${nomeTipo(salvo.tipo)} de ${empresaPorCnpj.get(salvo.empresa_cnpj)?.razao_social || formatarCnpj(salvo.empresa_cnpj)} salvo.`);
    } catch (e) { setErro(erroTexto(e)); }
    finally { setOcupado(""); }
  };

  const inputStyle = { ...S.inp, width: "100%", minWidth: 110 };
  const cardCount = (label, valor, cor) => <div key={label} style={{ ...S.card, padding: "11px 14px", minWidth: 130 }}><div style={{ fontSize: 10, color: C.muted }}>{label}</div><div style={{ fontSize: 19, fontWeight: 800, color: cor || C.text, marginTop: 3 }}>{valor}</div></div>;

  return <div style={{ display: "grid", gap: 14 }}>
    <div><div style={S.cardTitle}>Controle mensal de ICMS</div><div style={{ color: C.muted, fontSize: 12 }}>Acompanhe as obrigações de cada empresa por competência. O histórico dos meses anteriores permanece salvo.</div></div>
    {erro && <div role="alert" style={S.alert("error")}>{erro}</div>}
    {aviso && <div role="status" style={S.alert("success")}>{aviso}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8 }}>
      {cardCount("Obrigações", contagem.total)}
      {cardCount("Pendentes", contagem.pendentes, "#ffbd47")}
      {cardCount("Atrasadas", contagem.atrasados, contagem.atrasados ? "#fca5a5" : C.text)}
      {cardCount(`Vencem em até ${ALERTA_VENCIMENTO_DIAS} dias`, contagem.vencendo, contagem.vencendo ? "#ffbd47" : C.text)}
      {cardCount("Enviadas", contagem.enviados, "#34d399")}
      {cardCount("Sem movimento", contagem.semMovimento)}
    </div>

    <div style={S.card}>
      <div style={S.cardTitle}>Competência e vencimentos</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 12 }}>Competência<input type="month" value={competencia} onChange={e => { setCompetencia(e.target.value); setFiltroEmpresa(""); setFiltroSituacao(""); }} style={inputStyle}/></label>
        {TIPOS.map(([tipo, nome]) => <label key={tipo} style={{ fontSize: 12 }}>Vencimento padrão · {nome}<input type="date" value={vencimentos[tipo] || ""} onChange={e => setVencimentos(v => ({ ...v, [tipo]: e.target.value }))} style={inputStyle}/></label>)}
        <button type="button" disabled={!!ocupado || !empresas.some(item => item.ativa)} onClick={preparar} style={S.btn("primary")}>{ocupado === "preparar" ? "Preparando…" : "Preparar competência"}</button>
      </div>
      <p style={{ color: C.muted, fontSize: 11, marginBottom: 0 }}>O sistema cria somente os controles que ainda não existem para as empresas ativas. Vencimentos informados agora se aplicam aos novos controles.</p>
    </div>

    <div style={S.card}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <div style={{ ...S.cardTitle, flex: 1, margin: 0 }}>Obrigações de {competencia}</div>
        <label style={{ fontSize: 11 }}>Empresa<select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} style={{ ...inputStyle, minWidth: 200 }}><option value="">Todas</option>{empresas.map(item => <option key={item.cnpj} value={item.cnpj}>{item.razao_social}</option>)}</select></label>
        <label style={{ fontSize: 11 }}>Situação<select value={filtroSituacao} onChange={e => setFiltroSituacao(e.target.value)} style={{ ...inputStyle, minWidth: 170 }}><option value="">Todas</option>{SITUACOES.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
      </div>
      {!visiveis.length ? <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 22 }}>{empresas.length ? "Ainda não há controles nesta competência. Informe os vencimentos e clique em Preparar competência." : "Cadastre empresas antes de preparar os controles mensais."}</div> : <div style={{ overflowX: "auto" }}>
        <table style={{ ...S.table, minWidth: 1180 }}>
          <thead><tr>{["Empresa", "Obrigação", "Situação", "Vencimento", "Valor da guia (R$)", "Data de envio", "Observações", ""].map(rotulo => <th key={rotulo} style={S.th}>{rotulo}</th>)}</tr></thead>
          <tbody>{visiveis.map(item => {
            const draft = rascunhos[item.id] || item;
            const dirty = JSON.stringify(draft) !== JSON.stringify({ ...item, valor_guia: item.valor_guia == null ? "" : String(item.valor_guia) });
            return <tr key={item.id}>
              <td style={{ ...S.td, minWidth: 175 }}><strong>{empresaPorCnpj.get(item.empresa_cnpj)?.razao_social || "Empresa sem cadastro"}</strong><div style={{ fontSize: 10, color: C.muted }}>{formatarCnpj(item.empresa_cnpj)}</div></td>
              <td style={{ ...S.td, minWidth: 150 }}>{nomeTipo(item.tipo)}</td>
              <td style={{ ...S.td, minWidth: 140 }}><select value={draft.status} onChange={e => atualizarRascunho(item.id, "status", e.target.value)} style={inputStyle}>{SITUACOES.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select><div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{labelSituacao(item.status)}</div></td>
              <td style={{ ...S.td, minWidth: 130 }}><input type="date" value={draft.vencimento || ""} onChange={e => atualizarRascunho(item.id, "vencimento", e.target.value)} style={inputStyle}/></td>
              <td style={{ ...S.td, minWidth: 150 }}><input type="number" min="0" step="0.01" value={draft.valor_guia ?? ""} onChange={e => atualizarRascunho(item.id, "valor_guia", e.target.value)} style={inputStyle}/></td>
              <td style={{ ...S.td, minWidth: 130 }}><input type="date" value={draft.data_envio || ""} onChange={e => atualizarRascunho(item.id, "data_envio", e.target.value)} style={inputStyle}/></td>
              <td style={{ ...S.td, minWidth: 210 }}><input maxLength={4000} value={draft.observacoes || ""} onChange={e => atualizarRascunho(item.id, "observacoes", e.target.value)} style={inputStyle}/></td>
              <td style={S.td}><button disabled={!!ocupado || !dirty} onClick={() => salvar(item)} style={S.btn(dirty ? "primary" : "ghost")}>{ocupado === item.id ? "Salvando…" : "Salvar"}</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </div>
  </div>;
}
