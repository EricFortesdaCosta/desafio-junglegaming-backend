import { describe, expect, it } from 'bun:test';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
  computeCanonicalPayloadHash,
  LedgerDirection,
} from '../../src/domain/wager-transaction';
import { Money } from '../../src/domain/money';
import { InvalidTransactionStateError } from '../../src/domain/errors/domain-error';

describe('WagerTransaction Aggregate', () => {
  it('computes canonical payload hash consistently regardless of key order', () => {
    const payload1 = {
      roundId: 'round-1',
      providerId: 'provider-a',
      amount: '25.00',
      nested: { z: 1, a: 2 },
    };
    const payload2 = {
      nested: { a: 2, z: 1 },
      providerId: 'provider-a',
      amount: '25.00',
      roundId: 'round-1',
    };

    const hash1 = computeCanonicalPayloadHash(payload1);
    const hash2 = computeCanonicalPayloadHash(payload2);

    expect(hash1).toBe(hash2);
  });

  it('detects payload conflict when payload differs', () => {
    const hash1 = computeCanonicalPayloadHash({ amount: '25.00', roundId: 'r1' });
    const hash2 = computeCanonicalPayloadHash({ amount: '30.00', roundId: 'r1' });

    expect(hash1).not.toBe(hash2);
  });

  it('creates transaction in PENDING status', () => {
    const tx = WagerTransaction.create({
      id: 'tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'provider-a:ext-1',
      payloadHash: 'hash-123',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
  });

  it('prevents state transitions from terminal state PROCESSED', () => {
    const tx = WagerTransaction.create({
      id: 'tx-1',
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      idempotencyKey: 'provider-a:ext-1',
      payloadHash: 'hash-123',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    tx.markProcessed(undefined);
    expect(tx.isTerminal()).toBe(true);

    expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);
    expect(() => tx.markProcessed(undefined)).toThrow(InvalidTransactionStateError);
  });

  it('determines correct ledger directions', () => {
    const betTx = WagerTransaction.create({
      id: 'tx-bet',
      providerId: 'provider-a',
      externalTransactionId: 'ext-bet',
      idempotencyKey: 'key-bet',
      payloadHash: 'hash-1',
      walletId: 'w-1',
      playerId: 'p-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
    });

    expect(betTx.ledgerDirectionFor()).toBe(LedgerDirection.Debit);

    const winTx = WagerTransaction.create({
      id: 'tx-win',
      providerId: 'provider-a',
      externalTransactionId: 'ext-win',
      idempotencyKey: 'key-win',
      payloadHash: 'hash-2',
      walletId: 'w-1',
      playerId: 'p-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    expect(winTx.ledgerDirectionFor()).toBe(LedgerDirection.Credit);

    const rollbackBet = WagerTransaction.create({
      id: 'tx-rb',
      providerId: 'provider-a',
      externalTransactionId: 'ext-rb',
      idempotencyKey: 'key-rb',
      payloadHash: 'hash-3',
      walletId: 'w-1',
      playerId: 'p-1',
      roundId: 'r-1',
      gameId: 'g-1',
      kind: WagerTransactionKind.Rollback,
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet',
    });

    // Rollback of BET is Credit (reverses the debit)
    expect(rollbackBet.ledgerDirectionFor(betTx)).toBe(LedgerDirection.Credit);
  });
});
