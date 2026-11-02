export function calcularDigitoVerificadorChaveNfe(base43: string) {
  if (!/^\d{43}$/.test(base43)) throw new Error("A base da chave deve conter 43 dígitos.");
  let peso = 2;
  let soma = 0;
  for (let indice = 42; indice >= 0; indice -= 1) {
    soma += Number(base43[indice]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

export function chaveNfeValida(chave: string) {
  if (!/^\d{44}$/.test(chave) || chave.slice(20, 22) !== "55") return false;
  return Number(chave[43]) === calcularDigitoVerificadorChaveNfe(chave.slice(0, 43));
}
