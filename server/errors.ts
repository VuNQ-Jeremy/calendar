export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isNotFound(e: unknown): e is NotFoundError {
  return e instanceof NotFoundError;
}

export function isValidation(e: unknown): e is ValidationError {
  return e instanceof ValidationError;
}
