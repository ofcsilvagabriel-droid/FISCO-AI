import { logger } from "../logger/logger";
import { AppError } from "./AppError";

export function handleError(scope: string, err: unknown): AppError {
  const app =
    err instanceof AppError
      ? err
      : new AppError("UNKNOWN_ERROR", err instanceof Error ? err.message : String(err), { cause: err });
  logger.error(scope, app.message, { code: app.code, context: app.context });
  return app;
}
