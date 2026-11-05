import Decimal from 'decimal.js';
import { CurrencyMismatchError, InvalidMoneyError } from './errors/domain-error';

export interface MoneyProps {
  amount: string;   // decimal string with fixed 2 decimal places, e.g. "25.00"
  currency: string; // ISO-4217, e.g. "BRL"
}

export class Money {
  private static readonly DECIMAL_REGEX = /^\d+(\.\d{1,2})?$/;

  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {
    if (!currency || currency.trim().length !== 3) {
      throw new InvalidMoneyError(`Invalid currency code: ${currency}`);
    }
  }

  public static from(props: MoneyProps): Money {
    if (!props || typeof props.amount !== 'string' || typeof props.currency !== 'string') {
      throw new InvalidMoneyError('Amount and currency must be provided as strings');
    }

    const trimmedAmount = props.amount.trim();
    const trimmedCurrency = props.currency.trim().toUpperCase();

    if (!Money.DECIMAL_REGEX.test(trimmedAmount)) {
      throw new InvalidMoneyError(`Invalid monetary amount format: '${props.amount}'. Must be positive decimal with up to 2 decimal places.`);
    }

    const dec = new Decimal(trimmedAmount);
    if (!dec.isFinite() || dec.isNaN()) {
      throw new InvalidMoneyError('Amount must be a finite number');
    }

    if (dec.isNegative()) {
      throw new InvalidMoneyError('Contract input amount must not be negative');
    }

    return new Money(dec, trimmedCurrency);
  }

  public static fromRaw(amount: string | Decimal, currency: string): Money {
    const trimmedCurrency = currency.trim().toUpperCase();
    const dec = amount instanceof Decimal ? amount : new Decimal(amount);
    return new Money(dec, trimmedCurrency);
  }

  public static zero(currency: string): Money {
    return new Money(new Decimal(0), currency.trim().toUpperCase());
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  public negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  public isNegative(): boolean {
    return this.value.isNegative();
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  public toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  public toString(): string {
    return this.value.toFixed(2);
  }

  public get decimalValue(): Decimal {
    return this.value;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
