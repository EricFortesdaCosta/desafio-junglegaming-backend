import * as crypto from 'crypto';
import { Money, MoneyProps } from './money';
import { InvalidTransactionStateError } from './errors/domain-error';

export enum WagerTransactionKind {
  Opening  = 'OPENING',   // Internal: wallet opening balance credit
  Bet      = 'BET',
  Win      = 'WIN',
  Loss     = 'LOSS',
  Refund   = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending          = 'PENDING',            // Accepted, not yet applied
  PendingReference = 'PENDING_REFERENCE',  // Waiting for referenced transaction
  Processed        = 'PROCESSED',          // Successfully applied (terminal)
  Rejected         = 'REJECTED',           // Business rule violation (terminal)
  Failed           = 'FAILED',             // Infrastructure permanent failure (terminal)
}

export enum FailureCode {
  InsufficientFunds        = 'INSUFFICIENT_FUNDS',
  ReferenceNotFound        = 'REFERENCE_NOT_FOUND',
  ReferenceAlreadyReversed = 'REFERENCE_ALREADY_REVERSED',
  InvalidReferenceKind     = 'INVALID_REFERENCE_KIND',
  InvalidPayload           = 'INVALID_PAYLOAD',
  IdempotencyConflict      = 'IDEMPOTENCY_CONFLICT',
  CurrencyMismatch         = 'CURRENCY_MISMATCH',
  RoundMismatch            = 'ROUND_MISMATCH',
  NegativeBalanceReversal  = 'NEGATIVE_BALANCE_REVERSAL',
  TerminalStateViolation   = 'TERMINAL_STATE_VIOLATION',
  UnknownFailure           = 'UNKNOWN_FAILURE',
}

export enum LedgerDirection {
  Debit  = 'DEBIT',
  Credit = 'CREDIT',
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export function computeCanonicalPayloadHash(payload: Record<string, unknown>): string {
  const canonicalString = JSON.stringify(sortKeys(payload));
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  public static create(props: CreateWagerTransactionProps): WagerTransaction {
    const isReferenceRequired = props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback;
    if (isReferenceRequired && !props.referenceExternalTransactionId) {
      throw new Error(`Transaction kind ${props.kind} requires referenceExternalTransactionId`);
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  public static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public markProcessed(referenceTransactionId: string | undefined, at: Date = new Date()): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  public markPendingReference(): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.PendingReference;
  }

  public reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  public fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  public isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  public affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  public requiresReference(): boolean {
    return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
  }

  public matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Rollback:
        if (!reference) {
          throw new Error('Rollback requires a reference transaction to determine ledger direction');
        }
        // Inverses the original effect
        return reference.kind === WagerTransactionKind.Bet
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        throw new Error('LOSS transaction does not produce ledger entries');
    }
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Cannot transition transaction ${this.id} from terminal state ${this._status}`,
      );
    }
  }
}

