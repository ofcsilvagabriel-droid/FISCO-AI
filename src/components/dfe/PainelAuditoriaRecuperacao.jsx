import { useCallback, useEffect, useState } from "react";
import {
  listarCaixaEntradaFiscal,
  processarCaixaEntradaFiscal,
} from "@/modules/xml/services/recuperacaoXml.functions";

const erroTexto = (erro) => erro?.message || String(erro || "Falha inesperada.");
const dataHora = (valor) => (valor ? new Date(valor).toLocaleString("pt-BR") : "—");
const digitos = (valor) => String(valor || "").replace(/\D/g, "");
const cnpj = (valor) =>
  digitos(valor).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const STATUS = {
  NA_FILA: "Na fila",
  CONSULTANDO: "Consultando",
  ARMAZENADA: "Armazenada",
  IMPORTADA: "Importada",
  DUPLICADA: "Já existente",
  PROVEDOR_INDISPONIVEL: "Nova tentativa programada",
  BLOQUEADA: "Bloqueada temporariamente",
  FALHA_DEFINITIVA: "Nova rodada necessária",
  AGUARDANDO_EMPRESA: "Aguardando cadastro da empresa",
  XML_INCOMPLETO: "XML incompleto",
  NAO_ENCONTRADA: "Não encontrada",
};
const mensagemOperacional = (mensagem) => {
  const texto = String(mensagem || "");
  if (/api\/v1\/danfe|notas? antigas?|m[eê]s corrente/i.test(texto)) {
    return "Esta NF-e não está disponível automaticamente no provedor. Importe o XML pela área “Importar NF-e”.";
  }
  return texto;
};

export default function PainelAuditoriaRecuperacao({ S, C, onClose }) {
  const [dados, setDados] = useState({ lotes: [], itens: [], indicadores: {} });
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const carregar = useCallback(async () => setDados(await listarCaixaEntradaFiscal()), []);
  useEffect(() => {
    carregar().catch((e) => setErro(erroTexto(e)));
    const timer = window.setInterval(() => carregar().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [carregar]);

  const executar = async () => {
    setOcupado("worker");
    setErro("");
    try {
      await processarCaixaEntradaFiscal({ data: { limite: 5 } });
      await carregar();
    } catch (e) {
      setErro(erroTexto(e));
    } finally {
      setOcupado("");
    }
  };

  return (
    <section
      aria-label="Auditoria de recuperações"
      style={{
        ...S.card,
        marginBottom: 14,
        display: "grid",
        gap: 12,
        borderColor: `rgba(${C.blue},0.38)`,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ ...S.cardTitle, fontSize: 16 }}>Auditoria de recuperações</div>
          <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>
            Painel operacional recolhível. A fila continua funcionando na nuvem quando ele estiver
            fechado.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={executar} disabled={!!ocupado} style={S.btn("ghost")}>
            {ocupado ? "Executando…" : "Executar nova rodada"}
          </button>
          <button onClick={onClose} style={S.btn("ghost")} aria-label="Ocultar auditoria">
            Ocultar
          </button>
        </div>
      </header>
      {erro && (
        <div role="alert" style={S.alert("error")}>
          {erro}
        </div>
      )}
      <div
        style={{
          ...S.statsGrid,
          gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
          gap: 8,
        }}
      >
        {[
          ["Auditadas", dados.indicadores.total || 0],
          ["Aguardando empresa", dados.indicadores.aguardandoIdentificacao || 0],
          ["Em andamento", dados.indicadores.emAndamento || 0],
          ["Recuperadas", dados.indicadores.recuperadas || 0],
          ["Com falha", dados.indicadores.falhas || 0],
        ].map(([titulo, valor]) => (
          <div
            key={titulo}
            style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 11 }}
          >
            <div style={{ color: C.muted, fontSize: 10 }}>{titulo}</div>
            <strong style={{ fontSize: 20 }}>{valor}</strong>
          </div>
        ))}
      </div>
      {!dados.itens.length ? (
        <div style={{ color: C.muted, padding: "18px 0" }}>Nenhuma recuperação registrada.</div>
      ) : (
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: C.muted, textAlign: "left" }}>
                <th style={{ padding: "10px 8px" }}>NF-e / chave</th>
                <th>Empresa</th>
                <th>Estado</th>
                <th>Tentativas</th>
                <th>Atualização</th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((item) => (
                <tr key={item.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "11px 8px" }}>
                    <strong>
                      {item.numero_nfe_informado ? `NF-e ${item.numero_nfe_informado}` : "NF-e"}
                    </strong>
                    <div style={{ color: C.muted, fontFamily: "monospace", fontSize: 10 }}>
                      {item.chave_acesso}
                    </div>
                  </td>
                  <td>
                    {item.identificacao_origem === "XML_CONFIRMADO" && item.empresa_cnpj
                      ? `${cnpj(item.empresa_cnpj)} · XML confirmado`
                      : item.destinatario_cnpj_informado
                        ? `${cnpj(item.destinatario_cnpj_informado)} · indicado`
                        : "Aguardando XML"}
                  </td>
                  <td>
                    <span
                      style={{
                        color: ["ARMAZENADA", "IMPORTADA", "DUPLICADA"].includes(item.status)
                          ? `rgb(${C.green})`
                          : ["FALHA_DEFINITIVA", "XML_INCOMPLETO"].includes(item.status)
                            ? "#fca5a5"
                            : `rgb(${C.yellow})`,
                      }}
                    >
                      {STATUS[item.status] || item.status}
                    </span>
                    {item.ultimo_erro && (
                      <div style={{ color: "#fca5a5", fontSize: 10, marginTop: 3, maxWidth: 420 }}>
                        {mensagemOperacional(item.ultimo_erro)}
                      </div>
                    )}
                  </td>
                  <td>{item.tentativas || 0}</td>
                  <td>{dataHora(item.atualizado_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
