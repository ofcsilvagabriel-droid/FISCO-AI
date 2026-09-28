// ---------------------------------------------------------------------------
// Grafo force-directed otimizado (canvas puro, sem libs).
// - Repulsão O(n log n) via QuadTree com aproximação Barnes-Hut (theta).
// - Damping alto + decaimento de alpha → estabiliza rápido, sem tremor.
// - rAF só roda enquanto há energia/interação (idle = 0% CPU).
// - Culling de viewport, throttle de mousemove, DPR-aware, responsivo.
// - Paginação de nós, reset de layout e exportação de posições.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const CORES_REGIME = {
  ST: "#7c6cf0",
  DIFAL: "#4fd1c5",
  ANTECIPACAO: "#f6ad55",
  ISENTO: "#68d391",
  NAO_TRIBUTADO: "#a0aec0",
  PRESUNCAO_CREDITO: "#ed64a6",
  NORMAL: "#63b3ed",
};

const TEMA_PADRAO = {
  bg: "#141519",
  panel: "#1b1d23",
  border: "#2a2d36",
  sub: "#8b93a7",
  txt: "#d5d9e3",
  accent: "#7c6cf0",
};

// --------------------------------------------------------------- QuadTree
// Nó da árvore guarda massa e centro de massa para o Barnes-Hut.
class QuadTree {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.corpo = null;      // nó folha (partícula)
    this.dividido = false;
    this.massa = 0;
    this.cx = 0; this.cy = 0;
    this.filhos = null;
  }

  contem(p) {
    return p.x >= this.x && p.x < this.x + this.w && p.y >= this.y && p.y < this.y + this.h;
  }

  subdividir() {
    const hw = this.w / 2, hh = this.h / 2;
    this.filhos = [
      new QuadTree(this.x, this.y, hw, hh),
      new QuadTree(this.x + hw, this.y, hw, hh),
      new QuadTree(this.x, this.y + hh, hw, hh),
      new QuadTree(this.x + hw, this.y + hh, hw, hh),
    ];
    this.dividido = true;
  }

  inserir(p, profundidade = 0) {
    if (!this.contem(p)) return false;

    // acumula massa/centro de massa em todos os níveis
    const m = this.massa + 1;
    this.cx = (this.cx * this.massa + p.x) / m;
    this.cy = (this.cy * this.massa + p.y) / m;
    this.massa = m;

    if (!this.dividido && this.corpo === null) { this.corpo = p; return true; }
    if (profundidade > 24) return true; // evita recursão infinita em pontos coincidentes

    if (!this.dividido) {
      const antigo = this.corpo;
      this.corpo = null;
      this.subdividir();
      for (const f of this.filhos) if (f.inserir(antigo, profundidade + 1)) break;
    }
    for (const f of this.filhos) if (f.inserir(p, profundidade + 1)) return true;
    return true;
  }

  /** Aplica repulsão sobre `p` percorrendo a árvore com aproximação theta. */
  repelir(p, theta, forca, out) {
    if (this.massa === 0) return;
    let dx = this.cx - p.x, dy = this.cy - p.y;
    let d2 = dx * dx + dy * dy;
    if (d2 < 0.01) d2 = 0.01;

    const folha = !this.dividido;
    if (folha) {
      if (this.corpo === p || this.corpo === null) return;
    } else if (this.w * this.w / d2 > theta * theta) {
      for (const f of this.filhos) f.repelir(p, theta, forca, out);
      return;
    }

    const d = Math.sqrt(d2);
    const f = (forca * this.massa) / d2;
    out.x -= (dx / d) * f;
    out.y -= (dy / d) * f;
  }
}

// --------------------------------------------------------------- Componente
export default function GrafoForceOtimizado({
  dados = [],
  onAbrir,
  tema,
  regimeDe = () => "NORMAL",
  altura = 520,
  porPagina = 100,
}) {
  const T = { ...TEMA_PADRAO, ...(tema || {}) };
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rafRef = useRef(0);
  const stRef = useRef({
    nodes: [], links: [],
    view: { x: 0, y: 0, k: 1 },
    hover: null, drag: null, pan: null,
    alpha: 1, ultimoMove: 0, dpr: 1, W: 980, H: altura,
  });

  const [pagina, setPagina] = useState(1);
  const [stats, setStats] = useState({ nos: 0, arestas: 0, fps: 0 });

  const totalPaginas = Math.max(1, Math.ceil(dados.length / porPagina));
  useEffect(() => { setPagina(1); }, [dados.length, porPagina]);

  // ------------------------------------------------------------- modelo
  const modelo = useMemo(() => {
    const ini = (Math.min(pagina, totalPaginas) - 1) * porPagina;
    const fatia = dados.slice(ini, ini + porPagina);
    const nodes = fatia.map((h, i) => {
      const ang = i * 2.399963; // espiral áurea → distribuição inicial estável
      const raio = 12 * Math.sqrt(i + 1);
      return {
        id: `${h.empresa_id}::${h.ncm}::${h.aliquota_interestadual_faixa || "NA"}`,
        h,
        ncm: String(h.ncm || ""),
        empresa: h.empresa_id,
        regime: regimeDe(h),
        faixa: h.aliquota_interestadual_faixa || "NA",
        r: Math.min(26, 9 + (h.apuracoes?.length || 1) * 2),
        novo: Date.now() - new Date(h.atualizado_em || h.criado_em || Date.now()).getTime() < 7 * 864e5,
        x: Math.cos(ang) * raio,
        y: Math.sin(ang) * raio,
        vx: 0, vy: 0, t: 0,
      };
    });

    // ligações só entre vizinhos do mesmo grupo (evita O(n²) de arestas)
    const links = [];
    const grupos = new Map();
    nodes.forEach((n, i) => {
      const g = `${n.empresa}::${n.ncm.slice(0, 4)}`;
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(i);
    });
    grupos.forEach((idxs) => {
      for (let a = 0; a < idxs.length; a++) {
        for (let b = a + 1; b < Math.min(idxs.length, a + 6); b++) {
          const i = idxs[a], j = idxs[b];
          links.push({ s: i, t: j, forte: nodes[i].ncm === nodes[j].ncm });
        }
      }
    });
    return { nodes, links };
  }, [dados, pagina, porPagina, totalPaginas, regimeDe]);

  // ------------------------------------------------------------- loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = stRef.current;
    st.nodes = modelo.nodes;
    st.links = modelo.links;
    st.alpha = 1;
    st.hover = null; st.drag = null; st.pan = null;
    setStats((s) => ({ ...s, nos: modelo.nodes.length, arestas: modelo.links.length }));

    const ctx = canvas.getContext("2d", { alpha: false });

    const redimensionar = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const largura = wrapRef.current?.clientWidth || 980;
      st.dpr = dpr; st.W = largura; st.H = altura;
      canvas.width = Math.round(largura * dpr);
      canvas.height = Math.round(altura * dpr);
      canvas.style.width = `${largura}px`;
      canvas.style.height = `${altura}px`;
      reaquecer();
    };

    let ultimoFrame = performance.now();
    let acumFps = 60;

    const tick = () => {
      const n = st.nodes, l = st.links;
      const agora = performance.now();
      const dt = agora - ultimoFrame; ultimoFrame = agora;
      acumFps = acumFps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;

      // ---------------- simulação
      if (st.alpha > 0.01) {
        // 1) repulsão Barnes-Hut
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of n) {
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        if (n.length) {
          const lado = Math.max(maxX - minX, maxY - minY, 10) + 20;
          const qt = new QuadTree(minX - 10, minY - 10, lado, lado);
          for (const p of n) qt.inserir(p);
          const out = { x: 0, y: 0 };
          for (const p of n) {
            out.x = 0; out.y = 0;
            qt.repelir(p, 0.8, 900 * st.alpha, out);
            p.vx += out.x; p.vy += out.y;
          }
        }

        // 2) atração pelas arestas
        for (const link of l) {
          const a = n[link.s], b = n[link.t];
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const alvo = link.forte ? 55 : 110;
          const f = ((d - alvo) * 0.02 * st.alpha) / d;
          a.vx += dx * f; a.vy += dy * f;
          b.vx -= dx * f; b.vy -= dy * f;
        }

        // 3) gravidade + damping forte
        for (const p of n) {
          p.vx -= p.x * 0.01 * st.alpha;
          p.vy -= p.y * 0.01 * st.alpha;
          if (st.drag !== p) {
            // clamp de velocidade evita explosões numéricas
            const v = Math.hypot(p.vx, p.vy);
            if (v > 25) { p.vx = (p.vx / v) * 25; p.vy = (p.vy / v) * 25; }
            p.x += p.vx; p.y += p.vy;
          }
          p.vx *= 0.74; p.vy *= 0.74;
          p.t = Math.min(1, p.t + 0.08);
        }
        st.alpha *= 0.965;
        if (st.alpha <= 0.01) st.alpha = 0;
      }

      // ---------------- render
      const { W, H, dpr } = st;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2 + st.view.x, H / 2 + st.view.y);
      ctx.scale(st.view.k, st.view.k);

      // limites visíveis em coordenadas do mundo (culling)
      const halfW = W / 2 / st.view.k, halfH = H / 2 / st.view.k;
      const cxw = -st.view.x / st.view.k, cyw = -st.view.y / st.view.k;
      const visivel = (p, m = 40) =>
        Math.abs(p.x - cxw) < halfW + m && Math.abs(p.y - cyw) < halfH + m;

      ctx.strokeStyle = "rgba(140,150,175,0.12)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (const link of l) {
        const a = n[link.s], b = n[link.t];
        if (!a || !b) continue;
        if (st.hover === a || st.hover === b) continue;
        if (!visivel(a) && !visivel(b)) continue;
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      if (st.hover) {
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -(agora / 60) % 8;
        ctx.strokeStyle = "rgba(124,108,240,0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const link of l) {
          const a = n[link.s], b = n[link.t];
          if (!a || !b) continue;
          if (st.hover !== a && st.hover !== b) continue;
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.textAlign = "center";
      const mostrarLabel = st.view.k > 0.55;
      for (const p of n) {
        if (!visivel(p)) continue;
        const cor = CORES_REGIME[p.regime] || CORES_REGIME.NORMAL;
        const escala = 0.6 + 0.4 * p.t;
        ctx.globalAlpha = Math.min(1, 0.25 + p.t);
        if (st.hover === p) { ctx.shadowColor = cor; ctx.shadowBlur = 18; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * escala, 0, Math.PI * 2);
        ctx.fillStyle = "#1c2029"; ctx.fill();
        ctx.lineWidth = p.novo ? 2.4 : 1.2;
        ctx.strokeStyle = cor; ctx.stroke();
        ctx.shadowBlur = 0;
        if (mostrarLabel) {
          ctx.fillStyle = T.txt;
          ctx.font = "9px ui-monospace, monospace";
          ctx.fillText(p.ncm.slice(0, 8), p.x, p.y + p.r * escala + 11);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      const animando = st.alpha > 0 || st.drag || st.pan || n.some((p) => p.t < 1) || st.hover;
      rafRef.current = animando ? requestAnimationFrame(tick) : 0;
      if (!animando) setStats((s) => ({ ...s, fps: Math.round(acumFps) }));
    };

    function reaquecer() {
      if (!rafRef.current) { ultimoFrame = performance.now(); rafRef.current = requestAnimationFrame(tick); }
    }

    redimensionar();
    rafRef.current = requestAnimationFrame(tick);

    // ---------------- interação
    const pos = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (cx - r.left - st.W / 2 - st.view.x) / st.view.k,
        y: (cy - r.top - st.H / 2 - st.view.y) / st.view.k,
      };
    };
    const achar = (pt) => st.nodes.find((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= p.r + 4) || null;

    const onMove = (ev) => {
      const agora = performance.now();
      if (agora - st.ultimoMove < 16) return; // throttle ~60Hz
      st.ultimoMove = agora;
      const pt = pos(ev.clientX, ev.clientY);
      if (st.drag) { st.drag.x = pt.x; st.drag.y = pt.y; st.drag.vx = 0; st.drag.vy = 0; st.alpha = Math.max(st.alpha, 0.15); reaquecer(); return; }
      if (st.pan) { st.view.x += ev.clientX - st.pan.x; st.view.y += ev.clientY - st.pan.y; st.pan = { x: ev.clientX, y: ev.clientY }; reaquecer(); return; }
      const h = achar(pt);
      if (h !== st.hover) { st.hover = h; canvas.style.cursor = h ? "pointer" : "grab"; reaquecer(); }
    };
    const onDown = (ev) => {
      const h = achar(pos(ev.clientX, ev.clientY));
      if (h) { st.drag = h; st.dragMoveu = false; } else st.pan = { x: ev.clientX, y: ev.clientY };
      reaquecer();
    };
    const onUp = (ev) => {
      if (st.drag) {
        const h = achar(pos(ev.clientX, ev.clientY));
        if (h === st.drag && Math.hypot(st.drag.vx, st.drag.vy) < 2) onAbrir?.(st.drag.h);
      }
      st.drag = null; st.pan = null;
    };
    const onWheel = (ev) => {
      ev.preventDefault();
      const fator = ev.deltaY > 0 ? 0.92 : 1.09;
      st.view.k = Math.min(4, Math.max(0.2, st.view.k * fator));
      reaquecer();
    };
    // toque (mobile)
    const onTouchStart = (ev) => {
      const t = ev.touches[0]; if (!t) return;
      const h = achar(pos(t.clientX, t.clientY));
      if (h) st.drag = h; else st.pan = { x: t.clientX, y: t.clientY };
      reaquecer();
    };
    const onTouchMove = (ev) => {
      const t = ev.touches[0]; if (!t) return;
      ev.preventDefault();
      onMove({ clientX: t.clientX, clientY: t.clientY });
    };
    const onTouchEnd = () => { st.drag = null; st.pan = null; };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    window.addEventListener("mouseup", onUp);
    const ro = new ResizeObserver(redimensionar);
    if (wrapRef.current) ro.observe(wrapRef.current);

    stRef.current.reset = () => {
      st.view = { x: 0, y: 0, k: 1 };
      st.nodes.forEach((p, i) => {
        const ang = i * 2.399963, raio = 12 * Math.sqrt(i + 1);
        p.x = Math.cos(ang) * raio; p.y = Math.sin(ang) * raio;
        p.vx = 0; p.vy = 0; p.t = 0;
      });
      st.alpha = 1;
      reaquecer();
    };

    return () => {
      cancelAnimationFrame(rafRef.current); rafRef.current = 0;
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("mouseup", onUp);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelo, onAbrir, altura]);

  const resetar = useCallback(() => stRef.current.reset?.(), []);
  const exportarPosicoes = useCallback(() => {
    const dados = stRef.current.nodes.map((p) => ({ id: p.id, ncm: p.ncm, x: Math.round(p.x), y: Math.round(p.y), regime: p.regime }));
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `grafo-posicoes-p${pagina}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [pagina]);

  const btn = (ativo = true) => ({
    background: T.panel, color: ativo ? T.txt : T.sub, border: `1px solid ${T.border}`,
    borderRadius: 8, padding: "4px 10px", fontSize: 11, cursor: ativo ? "pointer" : "not-allowed",
    opacity: ativo ? 1 : 0.45,
  });

  return (
    <div className="animate-fadeIn" ref={wrapRef}
      style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ color: T.sub, fontSize: 11, marginBottom: 8 }}>
        🌐 Grafo de decisões fiscais — arraste os nós, role para zoom, arraste o fundo para mover · clique abre o NCM
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 8, fontSize: 10.5, alignItems: "center" }}>
        {Object.entries(CORES_REGIME).map(([k, c]) => (
          <span key={k} style={{ color: T.sub }}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, border: `2px solid ${c}`, marginRight: 4 }} />
            {k}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button style={btn()} onClick={resetar}>♻️ Reset layout</button>
        <button style={btn()} onClick={exportarPosicoes}>⬇️ Exportar posições</button>
      </div>

      <canvas ref={canvasRef}
        style={{ display: "block", width: "100%", background: T.bg, borderRadius: 10, border: `1px solid ${T.border}`, cursor: "grab", touchAction: "none" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button style={btn(pagina > 1)} disabled={pagina <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>← Anterior</button>
        <span style={{ color: T.sub, fontSize: 10.5 }}>Página {Math.min(pagina, totalPaginas)} de {totalPaginas}</span>
        <button style={btn(pagina < totalPaginas)} disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>Próxima →</button>
        <span style={{ color: T.sub, fontSize: 10.5, marginLeft: "auto" }}>
          {stats.nos} nós · {stats.arestas} conexões · {dados.length} registros no total{stats.fps ? ` · ~${stats.fps} FPS` : ""}
        </span>
      </div>
    </div>
  );
}
