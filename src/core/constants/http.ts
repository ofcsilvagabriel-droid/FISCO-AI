// Defaults do httpClient. Não conter secrets ou URLs de negócio.
export const HTTP_DEFAULTS = {
  timeoutMs: 15_000,
  retries: 1,
  retryDelayMs: 400,
} as const;
