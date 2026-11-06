import { Money, MoneyProps } from '../../domain/money';
import { WalletRepositoryPort, LedgerRepositoryPort } from '../ports/ports';

export interface ReconciliationReport {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly ledgerRepo: LedgerRepositoryPort,
  ) {}

  public async execute(walletId: string): Promise<ReconciliationReport> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new Error(`Wallet not found: ${walletId}`);
    }

    const calculatedSumString = await this.ledgerRepo.sumEntriesForWallet(walletId);
    const calculatedBalance = Money.fromRaw(calculatedSumString, wallet.currency);
    const storedBalance = wallet.balance;

    const diff = storedBalance.subtract(calculatedBalance);
    const consistent = diff.isZero();
    const checkedEntries = await this.ledgerRepo.countEntriesForWallet(walletId);

    if (!consistent) {
      console.warn(
        `[RECONCILIATION DISCREPANCY] Wallet ${walletId}: Stored=${storedBalance}, Calculated=${calculatedBalance}, Diff=${diff}`,
      );
    }

    return {
      walletId,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculatedBalance.toJSON(),
      difference: diff.toJSON(),
      consistent,
      checkedEntries,
    };
  }
}

