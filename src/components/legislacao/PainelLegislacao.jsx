// =====================================================================
// PAINEL DE LEGISLAÇÃO — vinculado à memória fiscal (estilo Obsidian)
// Mostra, para um NCM, todas as normas encontradas (RICMS/BA, Conv.
// 52/91, Conv. 142/18 e Cesta Básica BA), o nível de aderência do NCM,
// a MVA da faixa interestadual e as divergências frente à decisão
// memorizada. É somente leitura: nunca altera a decisão gravada.
// =====================================================================
import { useMemo } from "react";
import { LegislacaoMemoriaService } from "@/modules/fiscal/domain/services/LegislacaoMemoriaService";

const T = {
  panel: "#161922", panel2: "#1c2029", border: "#282d3a",
  text: "#d5d9e3", sub: "#8b93a7", accent: "#7c6cf0", accent2: "#4fd1c5",
  warn: "#f6ad55", danger: "#f56565", ok: "#68d391",
  mono: "ui-monospace,SFMono-Regular,'JetBrains Mono',Menlo,monospace",
};

const CORES_FONTE = {
  RICMS_BA: "#7c6cf0",
  CONV_52_91: "#4fd1c5",
  CONV_142_18: "#f6ad55",
  CESTA_BASICA_BA: "#68d391",
};

const ROTULO_FONTE = {
  RICMS_BA: "RICMS/BA — Anexo 1",
  CONV_52_91: "Convênio ICMS 52/91",
  CONV_142_18: "Convênio ICMS 142/18 (autopeças)",
  CESTA_BASICA_BA: "Cesta Básica BA",
};

const ROTULO_NIVEL = {
  EXATO_8: "NCM exato (8 díg.)",
  SUBPOSICAO_6: "Subposição (6 díg.)",
  POSICAO_4: "Posição (4 díg.)",
  CAPITULO_2: "Capítulo (2 díg.)",
  SEM_ADERENCIA: "sem aderência",
};

export default function PainelLegislacao({ ncm, descricao, segmento, faixa, decisao, compacto = false }) {
  const consulta = useMemo(
    () => LegislacaoMemoriaService.consultar(ncm, { descricao, segmento, ufDestino: "BA", aliquotaInterna: 20.5 }),
    [ncm, descricao, segmento],
  );

  const conferencia = useMemo(
    () => (decisao ? LegislacaoMemoriaService.conferirDecisao(consulta, { ...decisao, faixa }) : null),
    [consulta, decisao, faixa],
  );

  const mvaFaixa = LegislacaoMemoriaService.mvaDaFaixa(consulta, faixa);

  return (
    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.text }}>
      <div style={{ color: T.accent, fontWeight: 700, marginBottom: 6 }}>
        📜 LEGISLAÇÃO VINCULADA — NCM {consulta.ncm || "—"} ({consulta.normas.length} norma(s))
      </div>

      {conferencia && (
        <div style={{
          background: conferencia.coerente ? "#68d39115" : "#f6ad5515",
          border: `1px solid ${conferencia.coerente ? T.ok : T.warn}`,
          borderRadius: 9, padding: 9, marginBottom: 10,
        }}>
          <div style={{ color: conferencia.coerente ? T.ok : T.warn, fontWeight: 700 }}>
            {conferencia.coerente ? "✅ Decisão memorizada coerente com a legislação" : "⚠️ Divergências frente à legislação"}
          </div>
          {conferencia.divergencias.map((d, i) => (
            <div key={i} style={{ color: T.sub }}>· {d}</div>
          ))}
          {mvaFaixa && (
            <div style={{ color: T.sub }}>
              📐 MVA prevista no RICMS/BA para a faixa {faixa}%: <span style={{ color: T.accent2 }}>{mvaFaixa}</span>
            </div>
          )}
        </div>
      )}

      {consulta.avisos.map((a, i) => (
        <div key={i} style={{ color: T.warn, marginBottom: 4 }}>⚠️ {a}</div>
      ))}

      <div style={{ display: "grid", gap: 8, maxHeight: compacto ? 320 : 620, overflow: "auto" }}>
        {consulta.normas.map((nrm) => {
          const cor = CORES_FONTE[nrm.fonte] || T.accent;
          return (
            <div key={nrm.id} style={{ background: T.panel2, border: `1px solid ${T.border}`, borderLeft: `3px solid ${cor}`, borderRadius: 9, padding: 9 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ background: `${cor}22`, border: `1px solid ${cor}`, color: cor, borderRadius: 999, padding: "1px 8px", fontSize: 10.5 }}>
                  {ROTULO_FONTE[nrm.fonte] || nrm.fonte}
                </span>
                <span style={{ color: nrm.nivel === "EXATO_8" ? T.ok : T.warn, fontSize: 10.5 }}>
                  {ROTULO_NIVEL[nrm.nivel]} · {nrm.digitos} díg.
                </span>
                <span style={{ color: T.sub, fontSize: 10.5 }}>NCM {nrm.ncm}{nrm.cest ? ` · CEST ${nrm.cest}` : ""}</span>
              </div>
              <div style={{ marginTop: 4 }}>{nrm.descricao || "—"}</div>
              {nrm.segmento && <div style={{ color: T.sub }}>🏷️ {nrm.segmento}</div>}
              {nrm.mva && (nrm.mva["4"] || nrm.mva["7"] || nrm.mva["12"]) && (
                <div style={{ color: T.sub }}>
                  📐 MVA ajustada — 4%: {nrm.mva["4"] || "—"} · 7%: {nrm.mva["7"] || "—"} · 12%: {nrm.mva["12"] || "—"}
                </div>
              )}
              {nrm.fonte === "CONV_52_91" && (
                <div style={{ color: T.sub }}>
                  📉 Carga efetiva: {Number(nrm.extra?.carga_efetiva || 0).toFixed(2)}%
                  {nrm.extra?.perc_base_reduzida ? ` · base reduzida a ${(Number(nrm.extra.perc_base_reduzida) * 100).toFixed(2)}%` : ""}
                </div>
              )}
              {nrm.fonte === "CONV_142_18" && (
                <div style={{ color: T.sub }}>
                  📐 MVA padrão — interna BA {(Number(nrm.extra?.mva_interna_ba || 0) * 100).toFixed(0)}% ·
                  {" "}aquisições {(Number(nrm.extra?.mva_aquisicoes || 0) * 100).toFixed(0)}%
                </div>
              )}
              <div style={{ color: T.sub, marginTop: 4, borderTop: `1px dashed ${T.border}`, paddingTop: 4 }}>
                📌 {nrm.fundamento}
              </div>
            </div>
          );
        })}
        {!consulta.normas.length && (
          <div style={{ color: T.sub, background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 9, padding: 12 }}>
            Nenhuma norma localizada para este NCM. A descrição, isoladamente, nunca concede enquadramento ou benefício.
          </div>
        )}
      </div>
    </div>
  );
}
