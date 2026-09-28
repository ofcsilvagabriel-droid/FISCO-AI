// Painel de sincronização da Memória Fiscal com a nuvem (login + sync).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { MemoriaNuvemService } from "@/modules/fiscal/domain/services/MemoriaNuvemService";

export default function PainelNuvem({ T, onSincronizou }) {
  const [status, setStatus] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [ocupado, setOcupado] = useState("");

  const carregar = useCallback(async () => {
    try {
      const s = await MemoriaNuvemService.status();
      setStatus(s);
      setEventos(s.autenticado ? await MemoriaNuvemService.eventos(20) : []);
    } catch {
      setStatus({ autenticado: false, email: null, ultima_sincronizacao: null, registros_nuvem: 0, registros_locais: 0 });
    }
  }, []);

  useEffect(() => {
    carregar();
    const { data: sub } = supabase.auth.onAuthStateChange(() => carregar());
    return () => sub.subscription.unsubscribe();
  }, [carregar]);

  const rodar = async (nome, fn) => {
    setOcupado(nome);
    try {
      const r = await fn();
      toast.success(
        nome === "enviar"
          ? `${r.enviados} decisões enviadas para a nuvem`
          : nome === "receber"
            ? `${r.aplicados} de ${r.recebidos} registros aplicados localmente`
            : `Sincronizado: ${r.aplicados} baixados · ${r.enviados} enviados`,
      );
      await carregar();
      onSincronizou?.();
    } catch (e) {
      toast.error(e?.message || "Falha na sincronização");
    } finally {
      setOcupado("");
    }
  };

  const sair = async () => {
    await supabase.auth.signOut();
    await carregar();
  };

  const btn = (bg, borda) => ({
    padding: "7px 12px",
    borderRadius: 8,
    border: borda ? `1px solid ${T.border}` : "none",
    background: bg,
    color: borda ? T.text : "#fff",
    cursor: "pointer",
    fontSize: 12,
  });

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, fontSize: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontWeight: 700 }}>☁️ Memória na nuvem (espelho local mantido)</div>

      {!status?.autenticado ? (
        <>
          <div style={{ color: T.sub }}>
            Você está trabalhando apenas no navegador. Faça login para sincronizar suas decisões
            fiscais entre dispositivos — cada usuário enxerga somente a própria memória.
          </div>
          <a href="/auth" style={{ ...btn(T.accent, false), textDecoration: "none", display: "inline-block", width: "fit-content" }}>
            🔑 Entrar / criar conta
          </a>
        </>
      ) : (
        <>
          <div style={{ color: T.sub }}>
            Conectado como <strong style={{ color: T.text }}>{status.email}</strong> · {status.registros_locais} registros locais ·{" "}
            {status.registros_nuvem} na nuvem ·{" "}
            {status.ultima_sincronizacao
              ? `última sync ${new Date(status.ultima_sincronizacao).toLocaleString("pt-BR")}`
              : "nunca sincronizado"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={!!ocupado} onClick={() => rodar("sincronizar", MemoriaNuvemService.sincronizar)} style={btn(T.accent, false)}>
              {ocupado === "sincronizar" ? "Sincronizando…" : "🔄 Sincronizar tudo"}
            </button>
            <button disabled={!!ocupado} onClick={() => rodar("enviar", MemoriaNuvemService.enviar)} style={btn(T.panel2, true)}>
              ⬆️ Enviar local → nuvem
            </button>
            <button disabled={!!ocupado} onClick={() => rodar("receber", MemoriaNuvemService.receber)} style={btn(T.panel2, true)}>
              ⬇️ Baixar nuvem → local
            </button>
            <button disabled={!!ocupado} onClick={sair} style={btn(T.panel2, true)}>
              🚪 Sair da conta
            </button>
          </div>

          <div style={{ marginTop: 4 }}>
            <div style={{ color: T.sub, marginBottom: 6 }}>Últimos eventos remotos</div>
            {eventos.length === 0 ? (
              <div style={{ color: T.sub }}>Nenhum evento registrado ainda.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflow: "auto" }}>
                {eventos.map((ev) => (
                  <div key={ev.id} style={{ display: "flex", gap: 8, borderBottom: `1px solid ${T.border}`, padding: "4px 0" }}>
                    <span style={{ color: T.sub, minWidth: 130 }}>{new Date(ev.criado_em).toLocaleString("pt-BR")}</span>
                    <span style={{ color: T.accent }}>{ev.tipo}</span>
                    <span>{ev.descricao}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
