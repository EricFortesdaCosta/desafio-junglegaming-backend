import { describe, expect, it } from 'bun:test';
import { Money } from '../../src/domain/money';
import { CurrencyMismatchError, InvalidMoneyError } from '../../src/domain/errors/domain-error';

describe('Money Value Object', () => {
  it('creates money from valid props', () => {
    const m = Money.from({ amount: '25.00', currency: 'BRL' });
    expect(m.toString()).toBe('25.00');
    expect(m.currency).toBe('BRL');
    expect(m.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
  });

  it('rejects invalid inputs', () => {
    expect(() => Money.from({ amount: 'invalid', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '-10.00', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '10.123', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '1e5', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '', currency: 'BRL' })).toThrow(InvalidMoneyError);
    expect(() => Money.from({ amount: '10.00', currency: 'BR' })).toThrow(InvalidMoneyError);
  });

  it('adds two money instances correctly', () => {
    const a = Money.from({ amount: '10.50', currency: 'BRL' });
    const b = Money.from({ amount: '5.25', currency: 'BRL' });
    const result = a.add(b);
    expect(result.toString()).toBe('15.75');
    // Immutability check
    expect(a.toString()).toBe('10.50');
  });

  it('subtracts two money instances correctly', () => {
    const a = Money.from({ amount: '10.50', currency: 'BRL' });
    const b = Money.from({ amount: '5.50', currency: 'BRL' });
    const result = a.subtract(b);
    expect(result.toString()).toBe('5.00');
  });

  it('throws CurrencyMismatchError when operating across different currencies', () => {
    const brl = Money.from({ amount: '10.00', currency: 'BRL' });
    const usd = Money.from({ amount: '10.00', currency: 'USD' });
    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
  });

  it('evaluates comparison and equality correctly', () => {
    const a = Money.from({ amount: '10.00', currency: 'BRL' });
    const b = Money.from({ amount: '20.00', currency: 'BRL' });
    const c = Money.from({ amount: '10.00', currency: 'BRL' });

    expect(a.isLessThan(b)).toBe(true);
    expect(b.isLessThan(a)).toBe(false);
    expect(a.equals(c)).toBe(true);
    expect(a.equals(b)).toBe(false);
  });
});

