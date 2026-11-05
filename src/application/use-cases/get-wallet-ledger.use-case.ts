import { LedgerRepositoryPort } from '../ports/ports';
import { MoneyProps } from '../../domain/money';
import { LedgerDirection } from '../../domain/wager-transaction';

export interface LedgerEntryDTO {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: Date;
}

export interface GetWalletLedgerResult {
  items: LedgerEntryDTO[];
  nextCursor?: string;
}

export class GetWalletLedgerUseCase {
  constructor(private readonly ledgerRepo: LedgerRepositoryPort) {}

  public async execute(walletId: string, cursor?: string, limit: number = 50): Promise<GetWalletLedgerResult> {
    const page = await this.ledgerRepo.findByWalletId(walletId, cursor, limit);
    return {
      items: page.items.map((entry) => ({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt,
      })),
      nextCursor: page.nextCursor,
    };
  }
}
