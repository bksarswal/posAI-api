export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class TenantScopingError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 500, 'UNSCOPED_TENANT_ACCESS', details);
    this.name = 'TenantScopingError';
  }
}
