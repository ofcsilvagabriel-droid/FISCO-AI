export const estadoInicial = { visor: "0", acumulado: null, operador: null, novoNumero: true, erro: false };

const operar = (a, b, op) => op === "+" ? a + b : op === "−" ? a - b : op === "×" ? a * b : b === 0 ? NaN : a / b;
const mostrar = n => String(Number(n.toPrecision(12))).replace(".", ",");
const numero = visor => Number(visor.replace(",", "."));

export function atualizarCalculadora(estado, tecla) {
  if (tecla === "C") return { ...estadoInicial };
  if (estado.erro) estado = { ...estadoInicial };
  if (/^\d$/.test(tecla)) {
    const visor = estado.novoNumero || estado.visor === "0" ? tecla : estado.visor + tecla;
    return visor.length > 16 ? estado : { ...estado, visor, novoNumero: false };
  }
  if (tecla === ",") return { ...estado, visor: estado.novoNumero ? "0," : estado.visor.includes(",") ? estado.visor : estado.visor + ",", novoNumero: false };
  if (tecla === "⌫") return { ...estado, visor: estado.novoNumero ? "0" : estado.visor.slice(0, -1).replace(/^−?$/, "0").replace(/^-$/, "0"), novoNumero: false };
  const atual = numero(estado.visor);
  if (tecla === "±") return { ...estado, visor: mostrar(-atual) };
  if (tecla === "%") {
    const valor = estado.operador === "+" || estado.operador === "−" ? estado.acumulado * atual / 100 : atual / 100;
    return { ...estado, visor: mostrar(valor), novoNumero: false };
  }
  if (!["+", "−", "×", "÷", "="].includes(tecla)) return estado;
  if (tecla === "=" && (estado.operador == null || estado.novoNumero)) return estado;
  const valor = estado.operador && !estado.novoNumero ? operar(estado.acumulado, atual, estado.operador) : atual;
  if (!Number.isFinite(valor)) return { ...estadoInicial, visor: "Não é possível dividir por zero", erro: true };
  return { visor: mostrar(valor), acumulado: tecla === "=" ? null : valor, operador: tecla === "=" ? null : tecla, novoNumero: true, erro: false };
}
