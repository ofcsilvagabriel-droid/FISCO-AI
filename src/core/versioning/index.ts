// Versionamento da plataforma tributária. Todo cálculo/execução
// armazena este selo para permitir reconstrução futura.
export const VERSOES_PLATAFORMA = {
  motorTributario: "2.0.0",
  baseLegal: "RICMS-BA-2026.1+CONFAZ-2026.06",
  classificacao: "1.3.0",
  motorBeneficios: "1.0.0",
  score: "1.2.0",
  consolidador: "1.1.0",
  integrationCore: "1.0.0",
} as const;

export type SeloVersao = typeof VERSOES_PLATAFORMA;

export const Versioning = {
  selo(): SeloVersao { return { ...VERSOES_PLATAFORMA }; },
  /** Chave estável de versão — usada em cache e reconstrução. */
  hash(): string {
    return Object.values(VERSOES_PLATAFORMA).join("|");
  },
};
