import { describe, expect, it } from 'bun:test';
import { WalletLedgerEntry } from '../../src/domain/wallet-ledger-entry';
import { Money } from '../../src/domain/money';
import { LedgerDirection } from '../../src/domain/wager-transaction';
import { DomainError } from '../../src/domain/errors/domain-error';

describe('WalletLedgerEntry Entity', () => {
  it('creates a balanced debit entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'entry-1',
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '75.00', currency: 'BRL' }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
  });

  it('creates a balanced credit entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'entry-2',
      walletId: 'w-1',
      transactionId: 'tx-2',
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '75.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '125.00', currency: 'BRL' }),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Credit);
  });

  it('rejects an unbalanced entry where balance math does not check out', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'entry-bad',
        walletId: 'w-1',
        transactionId: 'tx-bad',
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: '25.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '70.00', currency: 'BRL' }), // wrong math
      }),
    ).toThrow(DomainError);
  });
});
