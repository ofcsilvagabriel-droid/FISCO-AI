// =====================================================================
// MEMÓRIA DE APURAÇÕES — INTERFACE "OBSIDIAN" PROTEGIDA POR SENHA
// ---------------------------------------------------------------------
// Consulta, edita e gerencia todo o histórico de cálculos por NCM,
// SEMPRE agrupado por empresa (regra 2: memória individual por empresa).
// A senha nunca é guardada em texto puro — comparação por hash SHA-256.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HistoricoApuracaoService } from "@/modules/fiscal/domain/services/HistoricoApuracaoService";
import PainelNuvem from "@/components/memoria/PainelNuvem";
import GrafoForceOtimizado, { CORES_REGIME } from "@/components/grafos/GrafoForceOtimizado";
import PainelLegislacao from "@/components/legislacao/PainelLegislacao";


const HASH_SENHA = "08453c591acdb90fca05299724bbd79e0b9198bd748445964ff40deb6d749a71";
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 5 * 60 * 1000;

const T = {
  bg: "#0f1117", panel: "#161922", panel2: "#1c2029", border: "#282d3a",
  text: "#d5d9e3", sub: "#8b93a7", accent: "#7c6cf0", accent2: "#4fd1c5",
  warn: "#f6ad55", danger: "#f56565", ok: "#68d391",
  mono: "ui-monospace,SFMono-Regular,'JetBrains Mono',Menlo,monospace",
};

async function sha256(txt) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

const fmt = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${Number(v || 0).toFixed(2).replace(".", ",")}%`;
const dt = (s) => (s ? new Date(s).toLocaleString("pt-BR") : "—");
const idDe = (h) => `${h.empresa_id}::${h.ncm}::${h.aliquota_interestadual_faixa || "NA"}`;
const tipoCor = (t) => (String(t || "").includes("MANUAL") || String(t || "").includes("CONGELADO") ? T.accent2 : String(t || "").includes("PAUTA") ? T.warn : T.ok);

// ---------------------------------------------------------------- LOGIN
function Login({ onEntrar }) {
  const [senha, setSenha] = useState("");
  const [tentativas, setTentativas] = useState(0);
  const [bloqueadoAte, setBloqueadoAte] = useState(0);
  const [erro, setErro] = useState("");

  const verificar = async () => {
    if (Date.now() < bloqueadoAte) {
      setErro(`Bloqueado até ${new Date(bloqueadoAte).toLocaleTimeString("pt-BR")}.`);
      return;
    }
    const hash = await sha256(senha);
    if (hash === HASH_SENHA) {
      setSenha(""); setErro(""); setTentativas(0);
      onEntrar();
      return;
    }
    const n = tentativas + 1;
    setTentativas(n);
    setSenha("");
    if (n >= MAX_TENTATIVAS) {
      setBloqueadoAte(Date.now() + BLOQUEIO_MS);
      setErro("Máximo de tentativas excedido. Tente novamente em 5 minutos.");
    } else {
      setErro(`Senha incorreta. Tentativa ${n}/${MAX_TENTATIVAS}`);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 420 }}>
      <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 14, padding: 30, width: 420, textAlign: "center", fontFamily: T.mono }}>
        <div style={{ fontSize: 34, marginBottom: 6 }}>🔐</div>
        <h2 style={{ color: T.text, fontSize: 16, margin: "0 0 6px" }}>MEMÓRIA DE APURAÇÕES PROTEGIDA</h2>
        <p style={{ color: T.sub, fontSize: 12, margin: "0 0 18px" }}>Acesse o histórico completo de cálculos por NCM</p>
        <input
          type="password" value={senha} placeholder="Senha de acesso"
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && verificar()}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.mono, marginBottom: 12 }}
        />
        <button onClick={verificar} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
          Acessar
        </button>
        {erro && <div style={{ marginTop: 12, color: T.danger, fontSize: 12 }}>⚠️ {erro}</div>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- GRAFO
// Motor force-directed otimizado (QuadTree/Barnes-Hut) em módulo próprio.
const regimeDe = (h) => {
  const a = h.apuracoes?.find((x) => x.id === h.versao_corrente?.id_apuracao) || h.apuracoes?.[h.apuracoes.length - 1];
  return a?.calculo_aplicado?.regime_tributario_aplicado || (a?.calculo_aplicado?.tributacao === "ICMS_ST" ? "ST" : "NORMAL");
};


// ------------------------------------------------------------- DETALHE

function DetalheNCM({ h, onChange, onLog }) {
  const [comparar, setComparar] = useState(null);
  const apuracoes = useMemo(
    () => [...(h.apuracoes || [])].sort((a, b) => (b.versao || 0) - (a.versao || 0)),
    [h],
  );
  const corrente = apuracoes.find((a) => a.id === h.versao_corrente?.id_apuracao) || apuracoes[0];
  const alteracoes = apuracoes.flatMap((a) => (a.alteracoes || []).map((x) => ({ ...x, versao: a.versao })))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const par = corrente?.calculo_aplicado?.parametros || {};

  const acao = (label, fn, cor = T.panel2) => (
    <button key={label} onClick={fn} disabled={h.bloqueado && label !== "🔓 Desbloquear edições"}
      style={{ padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.border}`, background: cor, color: T.text, fontSize: 11, cursor: "pointer", fontFamily: T.mono }}>
      {label}
    </button>
  );

  const variantes = useMemo(() => {
    try { return HistoricoApuracaoService.listarVariantes(h.ncm, h.empresa_id) || []; }
    catch { return []; }
  }, [h]);
  const regime = corrente?.calculo_aplicado?.regime_tributario_aplicado || "—";
  const origem = corrente?.calculo_aplicado?.origem_decisao || corrente?.calculo_aplicado?.tipo_calculo || "—";

  const badge = (txt, cor) => (
    <span style={{ background: `${cor}22`, border: `1px solid ${cor}`, color: cor, borderRadius: 999, padding: "1px 8px", fontSize: 10.5, marginRight: 6 }}>{txt}</span>
  );

  return (
    <div key={`${h.empresa_id}-${h.ncm}-${h.aliquota_interestadual_faixa || "NA"}`} className="animate-fadeIn"
      style={{ fontFamily: T.mono, color: T.text, fontSize: 12, lineHeight: 1.8 }}>
      <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 16, color: T.accent2 }}>📍 NCM {h.ncm} — {h.descricao_ncm_ultima_nota || "—"}</div>
        <div style={{ marginTop: 4 }}>
          {badge(regime, CORES_REGIME[regime] || T.accent)}
          {badge(origem, origem === "AUTOMATICO" ? T.ok : T.accent2)}
          {h.aliquota_interestadual_faixa && h.aliquota_interestadual_faixa !== "NA"
            ? badge(`inter. ${h.aliquota_interestadual_faixa}%`, T.warn) : null}
        </div>
        <div style={{ color: T.sub }}>
          🏢 Empresa: {h.empresa_id} · 📅 1ª decisão {dt(h.criado_em)} · última {dt(h.atualizado_em)}
          {h.vezes_aplicada ? ` · aplicada ${h.vezes_aplicada}×` : ""}
        </div>
        <div style={{ color: T.sub }}>
          📊 {h.total_apuracoes || apuracoes.length} versões de decisão · ✏️ {h.total_alteracoes || 0} alterações ·
          {" "}{h.ativo === false ? "🗄️ arquivado" : "✅ ativo"}{h.bloqueado ? " · 🔒 edições bloqueadas" : ""}
        </div>
      </div>

      {variantes.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: T.accent, fontWeight: 700 }}>🎚️ VARIANTES POR ALÍQUOTA INTERESTADUAL (MVA)</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, variantes.length)},1fr)`, gap: 8, marginTop: 6 }}>
            {variantes.map((v) => {
              const c = v.apuracoes?.find((a) => a.id === v.versao_corrente?.id_apuracao)?.calculo_aplicado || {};
              const ativo = (v.aliquota_interestadual_faixa || "NA") === (h.aliquota_interestadual_faixa || "NA");
              return (
                <div key={v.aliquota_interestadual_faixa || "NA"}
                  style={{ background: T.panel2, border: `1px solid ${ativo ? T.accent : T.border}`, borderRadius: 9, padding: 9 }}>
                  <div style={{ color: T.accent2 }}>
                    {v.aliquota_interestadual_faixa === "NA" ? "Sem faixa (não-ST)" : `Interestadual ${v.aliquota_interestadual_faixa}%`}
                  </div>
                  <div style={{ color: T.sub }}>Regime: {c.regime_tributario_aplicado || "—"}</div>
                  <div style={{ color: T.sub }}>
                    MVA informada: {c.parametros?.mva_informada != null ? pct(c.parametros.mva_informada) : "—"}
                    {c.parametros?.mva_ja_ajustada ? " (já ajustada)" : ""}
                  </div>
                  <div style={{ color: T.sub }}>Origem: {c.origem_decisao || "—"}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {corrente && (
        <div style={{ background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ color: tipoCor(corrente.calculo_aplicado?.tipo_calculo), fontWeight: 700 }}>
            📋 DECISÃO FISCAL CORRENTE (v{corrente.versao}) — {regime} · {origem}
            {corrente.foi_alterado ? " · ✏️ alterada" : ""}
          </div>
          <div>├─ MVA informada: {par.mva_informada != null ? pct(par.mva_informada) : "—"}{par.mva_ja_ajustada ? " (já ajustada)" : ""}</div>
          <div>├─ Alíquota interestadual de referência: {par.aliquota_interestadual_referencia != null ? pct(par.aliquota_interestadual_referencia) : (h.aliquota_interestadual_faixa !== "NA" ? `${h.aliquota_interestadual_faixa}%` : "—")}</div>
          <div>├─ FCP: {pct(par.fcp_percentual)} · Presunção de crédito: {par.presuncao_credito ? "sim" : "não"}</div>
          <div>├─ Pauta (informativo, nunca reaplicada): {par.pauta_aplicada || "—"}</div>
          <div style={{ color: T.sub }}>📌 {corrente.calculo_aplicado?.fundamento || "—"}</div>
          <div style={{ color: T.sub, marginTop: 6, borderTop: `1px dashed ${T.border}`, paddingTop: 6 }}>
            🧪 Valores monetários não são memorizados: eles são sempre apurados a partir do XML da nota atual.
          </div>
          <div style={{ color: T.sub }}>
            📍 Nota {corrente.nota_origem?.numero || "—"}/{corrente.nota_origem?.serie || "—"} · 🧑 {corrente.criado_por} · 📅 {dt(corrente.criado_em)}
          </div>
        </div>
      )}

      <div style={{ background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
        <PainelLegislacao
          ncm={h.ncm}
          descricao={h.descricao_ncm_ultima_nota}
          segmento={corrente?.calculo_aplicado?.segmento}
          faixa={h.aliquota_interestadual_faixa}
          decisao={{ regime, mva_informada: par.mva_informada }}
          compacto
        />
      </div>


      <div style={{ marginBottom: 14 }}>
        <div style={{ color: T.accent, fontWeight: 700 }}>🔄 HISTÓRICO DE ALTERAÇÕES ({alteracoes.length})</div>
        {alteracoes.length === 0 && <div style={{ color: T.sub }}>Nenhuma alteração registrada.</div>}
        {alteracoes.map((a, i) => (
          <div key={i} style={{ borderLeft: `2px solid ${T.accent}`, paddingLeft: 10, margin: "8px 0" }}>
            <div>✏️ v{a.versao} — {dt(a.data)} — por {a.por}</div>
            <div style={{ color: T.sub }}>├─ DE: {JSON.stringify(a.de)}</div>
            <div style={{ color: T.sub }}>├─ PARA: {JSON.stringify(a.para)}</div>
            <div style={{ color: T.sub }}>└─ MOTIVO: {a.motivo}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ color: T.accent, fontWeight: 700 }}>📚 TODAS AS VERSÕES ({apuracoes.length})</div>
        {apuracoes.map((a) => (
          <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0" }}>
            <span style={{ color: a.id === corrente?.id ? T.accent2 : T.sub, minWidth: 130 }}>
              [v{a.versao}]{a.id === corrente?.id ? " ⭐ corrente" : ""}
            </span>
            <span style={{ color: tipoCor(a.calculo_aplicado?.tipo_calculo) }}>{a.calculo_aplicado?.tipo_calculo}</span>
            <span>{a.calculo_aplicado?.tributacao}</span>
            <span style={{ color: T.sub }}>{dt(a.criado_em)} — {a.criado_por}</span>
            {a.id !== corrente?.id && (
              <button onClick={() => { HistoricoApuracaoService.reverterParaVersao(h.ncm, a.versao, h.empresa_id); onLog("REVERTEU", `NCM ${h.ncm} revertido para v${a.versao}`, h.ncm); onChange(); }}
                style={{ padding: "2px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.panel2, color: T.text, fontSize: 10, cursor: "pointer" }}>
                ↺ reverter
              </button>
            )}
            <button onClick={() => setComparar(comparar?.id === a.id ? null : a)}
              style={{ padding: "2px 8px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.panel2, color: T.text, fontSize: 10, cursor: "pointer" }}>
              ⇄ comparar
            </button>
          </div>
        ))}
      </div>

      {comparar && corrente && (
        <div style={{ background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ color: T.accent, fontWeight: 700 }}>⇄ COMPARAÇÃO v{corrente.versao} × v{comparar.versao} — análise de impacto</div>
          {[["Tributação", corrente.calculo_aplicado?.tributacao, comparar.calculo_aplicado?.tributacao],
            ["MVA", corrente.calculo_aplicado?.parametros?.mva_informada != null ? pct(corrente.calculo_aplicado.parametros.mva_informada) : "—", comparar.calculo_aplicado?.parametros?.mva_informada != null ? pct(comparar.calculo_aplicado.parametros.mva_informada) : "—"],
            ["FCP", pct(corrente.calculo_aplicado?.parametros?.fcp_percentual), pct(comparar.calculo_aplicado?.parametros?.fcp_percentual)]].map(([k, a, b]) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr", gap: 8 }}>
              <span style={{ color: T.sub }}>{k}</span><span>{a}</span>
              <span style={{ color: a === b ? T.sub : T.warn }}>{b}</span>
            </div>
          ))}
          <div style={{ marginTop: 6, color: T.warn }}>
            A comparação mostra apenas parâmetros fiscais; os valores serão calculados com os dados do XML atual.
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {acao(h.bloqueado ? "🔓 Desbloquear edições" : "🔒 Bloquear edições", () => {
          HistoricoApuracaoService.bloquearEdicoes(h.ncm, h.empresa_id, !h.bloqueado);
          onLog("BLOQUEIO", `NCM ${h.ncm} — edições ${h.bloqueado ? "desbloqueadas" : "bloqueadas"}`, h.ncm); onChange();
        })}
        {acao(h.ativo === false ? "♻️ Reativar NCM" : "🗄️ Arquivar NCM", () => {
          HistoricoApuracaoService.arquivarNCM(h.ncm, h.empresa_id, h.ativo === false);
          onLog("ARQUIVAMENTO", `NCM ${h.ncm} — ${h.ativo === false ? "reativado" : "arquivado"}`, h.ncm); onChange();
        })}
        {acao("🔗 Duplicar para outro NCM", () => {
          const destino = window.prompt("NCM de destino (mesma empresa):");
          if (!destino) return;
          HistoricoApuracaoService.duplicarParaNCM(h.ncm, destino, h.empresa_id, "Usuário");
          onLog("DUPLICOU", `Memória do NCM ${h.ncm} duplicada para ${destino}`, h.ncm); onChange();
        })}
        {acao("🗑️ Remover histórico", () => {
          if (!window.confirm(`Remover TODO o histórico do NCM ${h.ncm} desta empresa?`)) return;
          HistoricoApuracaoService.remover(h.ncm, h.empresa_id);
          onLog("REMOVEU", `Histórico do NCM ${h.ncm} removido`, h.ncm); onChange();
        }, "#3a1f26")}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- RAIZ
export default function MemoriaObsidian({ empresasNomes = {} }) {
  const [liberado, setLiberado] = useState(false);
  const [dados, setDados] = useState([]);
  const [sel, setSel] = useState(null);
  const [aba, setAba] = useState("ncms");
  const [busca, setBusca] = useState("");
  const [buscaLeg, setBuscaLeg] = useState("");
  const [descLeg, setDescLeg] = useState("");
  const [faixaLeg, setFaixaLeg] = useState("12");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [soAlteradas, setSoAlteradas] = useState(false);
  const [abertas, setAbertas] = useState({});
  const inputImport = useRef(null);

  const recarregar = useCallback(() => setDados(HistoricoApuracaoService.listarTudo()), []);
  useEffect(() => { if (liberado) recarregar(); }, [liberado, recarregar]);

  const registrarLog = useCallback((acao, descricao, ncm) => {
    HistoricoApuracaoService.registrarAcesso({ usuario: "Usuário", acao, descricao, ncm });
  }, []);

  const entrar = () => {
    setLiberado(true);
    HistoricoApuracaoService.registrarAcesso({ usuario: "Usuário", acao: "ACESSOU", descricao: "Consultou memória protegida" });
  };

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return dados.filter((h) => {
      if (filtroEmpresa && h.empresa_id !== filtroEmpresa) return false;
      if (soAlteradas && !(h.total_alteracoes > 0)) return false;
      if (filtroTipo) {
        const t = h.apuracoes?.find((a) => a.id === h.versao_corrente?.id_apuracao)?.calculo_aplicado?.tipo_calculo || "";
        if (filtroTipo === "MANUAL" && !(t.includes("MANUAL") || t.includes("CONGELADO"))) return false;
        if (filtroTipo === "PAUTA" && !t.includes("PAUTA")) return false;
        if (filtroTipo === "AUTOMATICO" && t !== "AUTOMATICO") return false;
      }
      if (!q) return true;
      return `${h.ncm} ${h.descricao_ncm_ultima_nota || ""} ${h.empresa_id}`.toLowerCase().includes(q);
    });
  }, [dados, busca, filtroTipo, filtroEmpresa, soAlteradas]);

  const grupos = useMemo(() => {
    const g = {};
    filtrados.forEach((h) => { (g[h.empresa_id || "SEM_EMPRESA"] = g[h.empresa_id || "SEM_EMPRESA"] || []).push(h); });
    return g;
  }, [filtrados]);

  const stats = useMemo(() => (liberado ? HistoricoApuracaoService.estatisticas() : null), [liberado, dados]);
  const acessos = useMemo(() => (liberado ? HistoricoApuracaoService.listarAcessos() : []), [liberado, dados]);

  if (!liberado) return <Login onEntrar={entrar} />;

  const exportar = (formato) => {
    let conteudo = ""; let mime = "application/json"; let ext = "json";
    if (formato === "csv") {
      const linhas = ["Empresa;NCM;Descricao;Versao;Regime;Faixa_Aliq_Interestadual;Origem_Decisao;MVA_Informada;MVA_Ja_Ajustada;FCP;Pauta;Criado_em;Criado_por"];
      filtrados.forEach((h) => (h.apuracoes || []).forEach((a) => {
        const c = a.calculo_aplicado || {}; const par = c.parametros || {};
        linhas.push([h.empresa_id, h.ncm, `"${h.descricao_ncm_ultima_nota || ""}"`, a.versao,
          c.regime_tributario_aplicado || c.tributacao || "", c.aliquota_interestadual_faixa || h.aliquota_interestadual_faixa || "NA",
          c.origem_decisao || c.tipo_calculo || "", par.mva_informada ?? "", par.mva_ja_ajustada ? "sim" : "nao",
          par.fcp_percentual ?? "", par.pauta_aplicada || "", a.criado_em, a.criado_por].join(";"));
      }));
      conteudo = "\uFEFF" + linhas.join("\n"); mime = "text/csv;charset=utf-8"; ext = "csv";
    } else {
      conteudo = JSON.stringify({ data_exportacao: new Date().toISOString(), historicos: filtrados }, null, 2);
    }
    const url = URL.createObjectURL(new Blob([conteudo], { type: mime }));
    const a = document.createElement("a"); a.href = url; a.download = `memoria_apuracoes_${Date.now()}.${ext}`; a.click();
    URL.revokeObjectURL(url);
    registrarLog("EXPORTOU", `Exportou ${filtrados.length} NCMs em ${ext.toUpperCase()}`);
  };

  const importar = async (file) => {
    const texto = await file.text();
    const n = HistoricoApuracaoService.importarJSON(texto);
    registrarLog("IMPORTOU", `Importou ${n} históricos de backup`);
    recarregar();
  };

  const abas = [["ncms", "📁 NCMs"], ["legislacao", "📜 Legislação"], ["stats", "📊 Estatísticas"], ["grafo", "🌐 Grafo"], ["auditoria", "🔐 Auditoria"], ["nuvem", "☁️ Nuvem"], ["dados", "📥 Importar/Exportar"]];

  return (
    <div style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, fontFamily: T.mono, color: T.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${T.border}`, paddingBottom: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>🔒 MEMÓRIA DE APURAÇÕES — OBSIDIAN</div>
          <div style={{ fontSize: 11, color: T.sub }}>Protegida · Acesso em {new Date().toLocaleString("pt-BR")}</div>
        </div>
        <button onClick={() => { setLiberado(false); setSel(null); }}
          style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.panel2, color: T.text, cursor: "pointer", fontSize: 12 }}>
          🔐 Sair
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {abas.map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)}
            style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${aba === id ? T.accent : T.border}`, background: aba === id ? T.accent : T.panel, color: aba === id ? "#fff" : T.text, fontSize: 12, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {aba === "ncms" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔍 Buscar NCM, descrição ou empresa"
              style={{ flex: 1, minWidth: 220, padding: "7px 10px", borderRadius: 8, background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.mono, fontSize: 12 }} />
            <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontSize: 12 }}>
              <option value="">Todas as empresas</option>
              {[...new Set(dados.map((h) => h.empresa_id))].map((e) => <option key={e} value={e}>{empresasNomes[e] || e}</option>)}
            </select>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, background: T.panel, border: `1px solid ${T.border}`, color: T.text, fontSize: 12 }}>
              <option value="">Todos os tipos</option>
              <option value="AUTOMATICO">Automático</option>
              <option value="PAUTA">Pauta</option>
              <option value="MANUAL">Manual/Congelado</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.sub }}>
              <input type="checkbox" checked={soAlteradas} onChange={(e) => setSoAlteradas(e.target.checked)} /> só com alterações
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 14, alignItems: "start" }}>
            <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, maxHeight: 620, overflow: "auto" }}>
              <div style={{ color: T.sub, fontSize: 11, marginBottom: 6 }}>📂 Empresas ({Object.keys(grupos).length})</div>
              {Object.entries(grupos).map(([emp, lista]) => (
                <div key={emp} style={{ marginBottom: 6 }}>
                  <div onClick={() => setAbertas((a) => ({ ...a, [emp]: !a[emp] }))}
                    style={{ cursor: "pointer", fontSize: 12, color: T.accent2, padding: "3px 0" }}>
                    {abertas[emp] === false ? "▸" : "▾"} {empresasNomes[emp] || emp} ({lista.length} NCMs)
                  </div>
                  <div style={{ overflow: "hidden", transition: "max-height 220ms ease-out, opacity 180ms ease-out",
                    maxHeight: abertas[emp] === false ? 0 : lista.length * 30 + 10, opacity: abertas[emp] === false ? 0 : 1 }}>
                  {lista.map((h) => (
                    <div key={idDe(h)} onClick={() => setSel(idDe(h))} className={sel === idDe(h) ? "animate-fadeIn" : undefined}
                      style={{ cursor: "pointer", padding: "3px 8px", marginLeft: 12, borderRadius: 6, fontSize: 11.5,
                        transition: "background 160ms ease-out",
                        background: sel === idDe(h) ? T.panel2 : "transparent",
                        borderLeft: sel === idDe(h) ? `2px solid ${T.accent}` : "2px solid transparent",
                        color: h.ativo === false ? T.sub : T.text }}>
                      {h.ncm} — {(h.descricao_ncm_ultima_nota || "").slice(0, 22) || "—"}
                      <span style={{ color: T.sub }}> (v{h.versao_corrente?.numero_versao || 1}{h.aliquota_interestadual_faixa && h.aliquota_interestadual_faixa !== "NA" ? ` · ${h.aliquota_interestadual_faixa}%` : ""}{h.total_alteracoes ? `, ${h.total_alteracoes} alt.` : ""})</span>
                    </div>
                  ))}
                  </div>
                </div>
              ))}
              {!Object.keys(grupos).length && <div style={{ color: T.sub, fontSize: 12 }}>Nenhum NCM na memória ainda.</div>}
            </div>

            <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, minHeight: 300 }}>
              {(() => {
                const h = dados.find((x) => idDe(x) === sel);
                if (!h) return <div style={{ color: T.sub, fontSize: 12 }}>Selecione um NCM na árvore à esquerda para ver o histórico completo.</div>;
                return <DetalheNCM h={h} onChange={recarregar} onLog={registrarLog} />;
              })()}
            </div>
          </div>
        </>
      )}

      {aba === "legislacao" && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input
              value={buscaLeg} onChange={(e) => setBuscaLeg(e.target.value)}
              placeholder="NCM (ex.: 22011000)"
              style={{ padding: "8px 10px", borderRadius: 8, background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.mono, width: 200 }}
            />
            <input
              value={descLeg} onChange={(e) => setDescLeg(e.target.value)}
              placeholder="Descrição do produto (opcional, apenas confere divergências)"
              style={{ flex: 1, minWidth: 240, padding: "8px 10px", borderRadius: 8, background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.mono }}
            />
            <select value={faixaLeg} onChange={(e) => setFaixaLeg(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 8, background: T.bg, border: `1px solid ${T.border}`, color: T.text, fontFamily: T.mono }}>
              <option value="4">Interestadual 4%</option>
              <option value="7">Interestadual 7%</option>
              <option value="12">Interestadual 12%</option>
              
            </select>
          </div>
          {String(buscaLeg).replace(/\D/g, "").length >= 2 ? (
            <PainelLegislacao ncm={buscaLeg} descricao={descLeg} faixa={faixaLeg} />
          ) : (
            <div style={{ color: T.sub, fontFamily: T.mono, fontSize: 12 }}>
              Informe ao menos 2 dígitos do NCM para consultar RICMS/BA, Convênios 52/91 e 142/18 e Cesta Básica BA.
            </div>
          )}
        </div>
      )}

      {aba === "stats" && stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 12, fontSize: 12 }}>
          {[["NCMs registrados", stats.total_ncms], ["Empresas", stats.total_empresas], ["Apurações totais", stats.total_apuracoes],
            ["Automáticas", stats.apuracoes_automaticas], ["Manuais/Congeladas", stats.apuracoes_manuais],
            ["NCMs com alterações", stats.ncms_com_alteracoes], ["Alterações registradas", stats.total_alteracoes],
            ["Média de versões por NCM", stats.media_versoes.toFixed(2)], ["NCMs novos (7 dias)", stats.ncms_novos_7d],
            ["Apurações (7 dias)", stats.apuracoes_7d]].map(([k, v]) => (
            <div key={k} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ color: T.sub, fontSize: 11 }}>{k}</div>
              <div style={{ fontSize: 20, color: T.accent2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {aba === "grafo" && (
        <GrafoForceOtimizado
          dados={filtrados}
          regimeDe={regimeDe}
          tema={{ bg: T.bg, panel: T.panel, border: T.border, sub: T.sub, txt: T.text, accent: T.accent }}
          porPagina={100}
          onAbrir={(h) => { setAba("ncms"); setSel(idDe(h)); }}
        />
      )}



      {aba === "auditoria" && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, fontSize: 12, maxHeight: 520, overflow: "auto" }}>
          <div style={{ color: T.sub, marginBottom: 8 }}>🔐 Log de acessos e alterações da memória ({acessos.length})</div>
          {acessos.map((a, i) => (
            <div key={i} style={{ borderBottom: `1px solid ${T.border}`, padding: "5px 0" }}>
              <span style={{ color: T.sub }}>{dt(a.data)}</span> · <span style={{ color: T.accent2 }}>{a.usuario}</span> ·
              {" "}<span style={{ color: T.warn }}>{a.acao}</span> · {a.descricao}{a.ncm_afetado ? ` (NCM ${a.ncm_afetado})` : ""}
            </div>
          ))}
          {!acessos.length && <div style={{ color: T.sub }}>Sem registros ainda.</div>}
        </div>
      )}

      {aba === "nuvem" && <PainelNuvem T={T} onSincronizou={recarregar} />}

      {aba === "dados" && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, fontSize: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div>📤 Exportar a seleção atual ({filtrados.length} NCMs):</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => exportar("json")} style={{ padding: "7px 12px", borderRadius: 8, border: "none", background: T.accent, color: "#fff", cursor: "pointer" }}>📥 JSON</button>
            <button onClick={() => exportar("csv")} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.panel2, color: T.text, cursor: "pointer" }}>📥 CSV / Excel</button>
          </div>
          <div style={{ marginTop: 8 }}>📥 Importar backup (mescla por empresa + NCM):</div>
          <input ref={inputImport} type="file" accept="application/json"
            onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])}
            style={{ color: T.sub, fontSize: 12 }} />
        </div>
      )}
    </div>
  );
}
