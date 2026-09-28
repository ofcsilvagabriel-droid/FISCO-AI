// Hierarquia de erros do app. Toda camada superior converte falhas
// externas em uma dessas classes para permitir tratamento uniforme.

export class AppError extends Error {
  readonly code: string;
  readonly cause?: unknown;
  readonly context?: Record<string, unknown>;
  constructor(code: string, message: string, opts?: { cause?: unknown; context?: Record<string, unknown> }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.cause = opts?.cause;
    this.context = opts?.context;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, { context });
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string | number) {
    super("NOT_FOUND", `${entity}${id ? ` ${id}` : ""} não encontrado`, { context: { entity, id } });
  }
}

export class DomainError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super("DOMAIN_ERROR", message, { context });
  }
}

export class IntegrationError extends AppError {
  readonly status?: number;
  constructor(message: string, opts?: { status?: number; cause?: unknown; context?: Record<string, unknown> }) {
    super("INTEGRATION_ERROR", message, { cause: opts?.cause, context: opts?.context });
    this.status = opts?.status;
  }
}

export class StorageError extends AppError {
  constructor(message: string, cause?: unknown) {
    super("STORAGE_ERROR", message, { cause });
  }
}
