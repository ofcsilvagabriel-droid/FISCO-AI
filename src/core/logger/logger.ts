// Logger estruturado. Sink padrão = console; níveis controlados por
// import.meta.env.DEV. Uso: logger.info("scope", { data }).
type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN: Level = import.meta.env?.DEV ? "debug" : "info";

function emit(level: Level, scope: string, message: string, meta?: unknown) {
  if (ORDER[level] < ORDER[MIN]) return;
  const payload = { ts: new Date().toISOString(), level, scope, message, meta };
  // eslint-disable-next-line no-console
  (console[level] ?? console.log)(`[${scope}] ${message}`, meta ?? "");
  return payload;
}

export const logger = {
  debug: (scope: string, message: string, meta?: unknown) => emit("debug", scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) => emit("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => emit("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => emit("error", scope, message, meta),
};

export type Logger = typeof logger;
