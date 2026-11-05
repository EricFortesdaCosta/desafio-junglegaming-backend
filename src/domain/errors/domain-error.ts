export class DomainError extends Error {
  constructor(message: string, public readonly code: string = 'DOMAIN_ERROR') {
    super(message);
    this.name = 'DomainError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string) {
    super(`Currency mismatch: expected ${expected}, got ${actual}`, 'CURRENCY_MISMATCH');
    this.name = 'CurrencyMismatchError';
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(available: string, requested: string) {
    super(`Insufficient funds: available ${available}, requested ${requested}`, 'INSUFFICIENT_FUNDS');
    this.name = 'InsufficientFundsError';
  }
}

export class InvalidMoneyError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_MONEY');
    this.name = 'InvalidMoneyError';
  }
}

export class InvalidTransactionStateError extends DomainError {
  constructor(message: string) {
    super(message, 'TERMINAL_STATE_VIOLATION');
    this.name = 'InvalidTransactionStateError';
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'IDEMPOTENCY_CONFLICT');
    this.name = 'IdempotencyConflictError';
  }
}
