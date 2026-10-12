import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator, GripHorizontal, Minus, Plus, X, Grip } from "lucide-react";
import { atualizarCalculadora, estadoInicial } from "./calculadora";
import "./CalculadoraFlutuante.css";

const MARGEM = 8;
const TAMANHO = { largura: 300, altura: 408 };
const TECLAS = ["C", "⌫", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "±", "0", ",", "="];
const ROTULOS = { C: "Limpar", "⌫": "Apagar último dígito", "%": "Porcentagem", "÷": "Dividir", "×": "Multiplicar", "−": "Subtrair", "+": "Somar", "±": "Inverter sinal", ",": "Vírgula decimal", "=": "Calcular resultado" };

function limitar(janela) {
  const largura = Math.min(Math.max(260, janela.largura), 600, window.innerWidth - MARGEM * 2);
  const altura = Math.min(Math.max(350, janela.altura), 760, window.innerHeight - MARGEM * 2);
  return { largura, altura, x: Math.max(MARGEM, Math.min(janela.x, window.innerWidth - largura - MARGEM)), y: Math.max(MARGEM, Math.min(janela.y, window.innerHeight - altura - MARGEM)) };
}

export default function CalculadoraFlutuante() {
  const [aberta, setAberta] = useState(false);
  const [janela, setJanela] = useState({ ...TAMANHO, x: 24, y: 80 });
  const [estado, pressionar] = useReducer(atualizarCalculadora, estadoInicial);
  const gesto = useRef(null);
  const painel = useRef(null);
  const abrirBotao = useRef(null);

  useEffect(() => {
    if (!aberta) return;
    const ajustar = () => setJanela(atual => limitar(atual));
    ajustar();
    painel.current?.focus();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [aberta]);

  const fechar = () => { gesto.current = null; setAberta(false); abrirBotao.current?.focus(); };
  const iniciar = (evento, tipo) => {
    if (evento.button !== 0) return;
    evento.preventDefault();
    evento.currentTarget.focus();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    gesto.current = { tipo, x: evento.clientX, y: evento.clientY, janela };
  };
  const mover = evento => {
    const inicio = gesto.current;
    if (!inicio) return;
    const dx = evento.clientX - inicio.x, dy = evento.clientY - inicio.y;
    setJanela(limitar(inicio.tipo === "mover"
      ? { ...inicio.janela, x: inicio.janela.x + dx, y: inicio.janela.y + dy }
      : { ...inicio.janela, largura: inicio.janela.largura + dx, altura: inicio.janela.altura + dy }));
  };
  const terminar = () => { gesto.current = null; };
  const mudarTamanho = delta => setJanela(atual => limitar({ ...atual, largura: atual.largura + delta, altura: atual.altura + delta }));
  const moverTeclado = (evento, tipo) => {
    if (!evento.key.startsWith("Arrow")) return;
    evento.preventDefault(); evento.stopPropagation();
    const passo = evento.shiftKey ? 40 : 10;
    const dx = evento.key === "ArrowRight" ? passo : evento.key === "ArrowLeft" ? -passo : 0;
    const dy = evento.key === "ArrowDown" ? passo : evento.key === "ArrowUp" ? -passo : 0;
    setJanela(atual => limitar(tipo === "mover" ? { ...atual, x: atual.x + dx, y: atual.y + dy } : { ...atual, largura: atual.largura + dx, altura: atual.altura + dy }));
  };
  const teclado = evento => {
    if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (evento.key === "Escape") { evento.stopPropagation(); fechar(); return; }
    // Enter/Space nos botões mantêm a ativação nativa e acessível.
    if (evento.target.tagName === "BUTTON" && ["Enter", " "].includes(evento.key)) return;
    const tecla = { Enter: "=", Backspace: "⌫", Delete: "C", ".": ",", "*": "×", "/": "÷", "-": "−" }[evento.key] || evento.key;
    if (!TECLAS.includes(tecla)) return;
    evento.preventDefault(); evento.stopPropagation(); pressionar(tecla);
  };
  const gestos = tipo => ({ onPointerDown: e => iniciar(e, tipo), onPointerMove: mover, onPointerUp: terminar, onPointerCancel: terminar, onLostPointerCapture: terminar, onKeyDown: e => moverTeclado(e, tipo) });

  return <>
    <button ref={abrirBotao} className="calculadora-abrir" type="button" aria-label="Abrir calculadora flutuante" aria-expanded={aberta} onClick={() => setAberta(atual => !atual)}>
      <Calculator size={18} aria-hidden="true" /><span>Calculadora</span>
    </button>
    {aberta && createPortal(
      <section ref={painel} className="calculadora-flutuante" role="dialog" aria-modal="false" aria-label="Calculadora flutuante" tabIndex={-1} onKeyDown={teclado}
        style={{ left: janela.x, top: janela.y, width: janela.largura, height: janela.altura }}>
        <div className="calculadora-cabecalho">
          <button className="calculadora-mover" type="button" title="Arraste para mover ou use as setas do teclado" aria-label="Mover calculadora" {...gestos("mover")}>
            <GripHorizontal size={18} aria-hidden="true" /><span>Calculadora</span>
          </button>
          <button type="button" aria-label="Diminuir calculadora" title="Diminuir" onClick={() => mudarTamanho(-40)}><Minus size={16} /></button>
          <button type="button" aria-label="Aumentar calculadora" title="Aumentar" onClick={() => mudarTamanho(40)}><Plus size={16} /></button>
          <button type="button" aria-label="Fechar calculadora" title="Fechar" onClick={fechar}><X size={16} /></button>
        </div>
        <div className="calculadora-conteudo">
          <div className="calculadora-operacao">{estado.operador ? `${estado.acumulado.toLocaleString("pt-BR", { maximumFractionDigits: 12 })} ${estado.operador}` : "Cálculo livre"}</div>
          <output className={estado.erro ? "calculadora-visor calculadora-erro" : "calculadora-visor"} aria-live="polite" aria-label="Resultado">{estado.visor}</output>
          <div className="calculadora-teclas">{TECLAS.map(tecla => <button key={tecla} type="button" aria-label={ROTULOS[tecla] || tecla} className={tecla === "=" ? "calculadora-igual" : /[+−×÷%]/.test(tecla) ? "calculadora-operador" : ""} onClick={() => pressionar(tecla)}>{tecla}</button>)}</div>
        </div>
        <div className="calculadora-rodape"><span>Arraste o canto para ajustar</span><button type="button" className="calculadora-redimensionar" aria-label="Redimensionar calculadora" title="Arraste ou use as setas do teclado" {...gestos("tamanho")}><Grip size={16} /></button></div>
      </section>, document.body)}
  </>;
}
