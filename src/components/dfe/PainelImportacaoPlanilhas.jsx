import { useCallback, useEffect, useState } from "react";
import {
  criarLoteRecuperacaoXml,
  listarImportacoesPlanilhas,
} from "@/modules/xml/services/recuperacaoXml.functions";
import {
  interpretarPlanilhaSefazCsv,
  prepararItensCaixaEntradaPlanilhaSefaz,
} from "@/modules/xml/domain/planilhaSefaz";

const erroTexto = (erro) => erro?.message || String(erro || "Falha inesperada.");
const dataHora = (valor) => (valor ? new Date(valor).toLocaleString("pt-BR") : "—");
const hashTexto = async (texto) => {
  const bytes = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export default function PainelImportacaoPlanilhas({ S, C }) {
  const [previsao, setPrevisao] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => setHistorico(await listarImportacoesPlanilhas()), []);
  useEffect(() => {
    carregar().catch((e) => setErro(erroTexto(e)));
  }, [carregar]);

  const receber = async (evento) => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setOcupado("arquivo");
    setErro("");
    setAviso("");
    try {
      if (!/\.csv$/i.test(arquivo.name)) throw new Error("Selecione o CSV exportado pela SEFAZ.");
      const texto = await arquivo.text();
      const resultado = interpretarPlanilhaSefazCsv(texto);
      const itens = prepararItensCaixaEntradaPlanilhaSefaz(resultado);
      if (!itens.length)
        throw new Error("A planilha não possui nenhuma chave válida de NF-e modelo 55.");
      setPrevisao({ nome: arquivo.name, hash: await hashTexto(texto), resultado, itens });
    } catch (e) {
      setErro(erroTexto(e));
    } finally {
      setOcupado("");
      evento.target.value = "";
    }
  };

  const confirmar = async () => {
    if (!previsao) return;
    setOcupado("importar");
    setErro("");
    setAviso("");
    try {
      let enfileiradas = 0,
        duplicadas = 0,
        indicadas = 0;
      for (let inicio = 0; inicio < previsao.itens.length; inicio += 500) {
        const resultado = await criarLoteRecuperacaoXml({
          data: {
            itens: previsao.itens.slice(inicio, inicio + 500),
            origem: "ARQUIVO_CHAVES",
            nomeArquivo: previsao.nome,
          arquivoSha256: inicio + 500 >= previsao.itens.length ? previsao.hash : null,
            totalLinhas: previsao.resultado.linhas.length,
          },
        });
        enfileiradas += resultado.enfileiradas;
        duplicadas += resultado.duplicadas;
        indicadas += resultado.indicadas || 0;
      }
      setAviso(
        `${enfileiradas} chave(s) adicionada(s); ${duplicadas} já existiam. ${indicadas} linha(s) possuem destinatário apenas indicativo; o XML definirá a empresa.`,
      );
      setPrevisao(null);
      await carregar();
    } catch (e) {
      setErro(erroTexto(e));
    } finally {
      setOcupado("");
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <header>
        <div style={{ ...S.cardTitle, fontSize: 18 }}>Importação de planilhas</div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
          Ambiente independente para receber relatórios da SEFAZ. A empresa aberta na tela nunca
          define o destino dos documentos.
        </div>
      </header>
      {erro && (
        <div role="alert" style={S.alert("error")}>
          {erro}
        </div>
      )}
      {aviso && (
        <div role="status" style={S.alert("success")}>
          {aviso}
        </div>
      )}

      <section style={{ ...S.card, display: "grid", gap: 12 }}>
        <div style={S.cardTitle}>Nova importação</div>
        <div style={{ color: C.muted, fontSize: 12, maxWidth: 760 }}>
          Envie o arquivo CSV da consulta de destinatário. O FiscoAI valida as linhas e deduplica as
          chaves antes de criar a fila de recuperação.
        </div>
        <label
          style={{
            ...S.btn("primary"),
            width: "fit-content",
            cursor: ocupado ? "wait" : "pointer",
          }}
        >
          {ocupado === "arquivo" ? "Analisando…" : "Selecionar planilha CSV"}
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={!!ocupado}
            onChange={receber}
            style={{ display: "none" }}
          />
        </label>
      </section>

      {previsao && (
        <section
          style={{ ...S.card, display: "grid", gap: 12, borderColor: `rgba(${C.blue},0.45)` }}
        >
          <div>
            <div style={S.cardTitle}>Conferência antes de importar</div>
            <div style={{ color: C.muted, fontSize: 11 }}>{previsao.nome}</div>
          </div>
          <div
            style={{
              ...S.statsGrid,
              gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
              gap: 8,
            }}
          >
            {[
              ["Linhas", previsao.resultado.linhas.length],
              ["NF-e válidas", previsao.itens.length],
              ["Duplicadas no arquivo", previsao.resultado.duplicadas.length],
              ["Inválidas", previsao.resultado.invalidas.length],
              [
                "Destinatário indicado",
                previsao.itens.filter((item) => item.destinatarioCnpj).length,
              ],
            ].map(([titulo, valor]) => (
              <div
                key={titulo}
                style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 12 }}
              >
                <div style={{ color: C.muted, fontSize: 10 }}>{titulo}</div>
                <strong style={{ fontSize: 20 }}>{valor}</strong>
              </div>
            ))}
          </div>
          <div style={S.alert("info")}>
            <strong>Isolamento empresarial:</strong> o destinatário da planilha é apenas uma pista
            de auditoria. O vínculo definitivo ocorrerá somente depois de o CNPJ ser confirmado no
            XML completo.
          </div>
          {!!previsao.resultado.invalidas.length && (
            <div style={S.alert("warn")}>
              Linhas ignoradas por chave inválida:{" "}
              {previsao.resultado.invalidas
                .slice(0, 20)
                .map((item) => item.linha)
                .join(", ")}
              {previsao.resultado.invalidas.length > 20 ? "…" : ""}.
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setPrevisao(null)} disabled={!!ocupado} style={S.btn("ghost")}>
              Cancelar
            </button>
            <button onClick={confirmar} disabled={!!ocupado} style={S.btn("primary")}>
              {ocupado === "importar"
                ? "Importando…"
                : `Importar ${previsao.itens.length} chave(s)`}
            </button>
          </div>
        </section>
      )}

      <section style={S.card}>
        <div style={S.cardTitle}>Histórico de planilhas</div>
        {!historico.length ? (
          <div style={{ color: C.muted, padding: "20px 0" }}>Nenhuma planilha importada.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: C.muted, textAlign: "left" }}>
                  <th style={{ padding: "10px 8px" }}>Arquivo</th>
                  <th>Status</th>
                  <th>Chaves</th>
                  <th>Recuperadas</th>
                  <th>Falhas</th>
                  <th>Importação</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((lote) => (
                  <tr key={lote.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "11px 8px", fontWeight: 600 }}>
                      {lote.nome_arquivo || "Planilha sem nome"}
                    </td>
                    <td>{lote.status}</td>
                    <td>{lote.total_itens}</td>
                    <td style={{ color: `rgb(${C.green})` }}>{lote.total_recuperados}</td>
                    <td style={{ color: lote.total_falhas ? "#fca5a5" : C.muted }}>
                      {lote.total_falhas}
                    </td>
                    <td>{dataHora(lote.criado_em)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
