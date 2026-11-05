import { describe, expect, it } from 'bun:test';
import { Wallet } from '../../src/domain/wallet';
import { Money } from '../../src/domain/money';
import { InsufficientFundsError, CurrencyMismatchError } from '../../src/domain/errors/domain-error';

describe('Wallet Aggregate Root', () => {
  it('opens a wallet with positive initial balance', () => {
    const initial = Money.from({ amount: '100.00', currency: 'BRL' });
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: initial,
    });

    expect(wallet.id).toBe('wallet-1');
    expect(wallet.playerId).toBe('player-1');
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('debits wallet and increments version', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    const { balanceBefore, balanceAfter } = wallet.debit(Money.from({ amount: '35.50', currency: 'BRL' }));
    expect(balanceBefore.toString()).toBe('100.00');
    expect(balanceAfter.toString()).toBe('64.50');
    expect(wallet.balance.toString()).toBe('64.50');
    expect(wallet.version).toBe(2);
  });

  it('credits wallet and increments version', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    const { balanceBefore, balanceAfter } = wallet.credit(Money.from({ amount: '50.00', currency: 'BRL' }));
    expect(balanceBefore.toString()).toBe('50.00');
    expect(balanceAfter.toString()).toBe('100.00');
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(2);
  });

  it('rejects debit when balance is insufficient (never allows negative balance)', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    expect(() => wallet.debit(Money.from({ amount: '100.01', currency: 'BRL' }))).toThrow(InsufficientFundsError);
    // Balance and version must remain untouched
    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('rejects operations with different currency', () => {
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    expect(() => wallet.debit(Money.from({ amount: '10.00', currency: 'USD' }))).toThrow(CurrencyMismatchError);
    expect(() => wallet.credit(Money.from({ amount: '10.00', currency: 'EUR' }))).toThrow(CurrencyMismatchError);
  });
});
