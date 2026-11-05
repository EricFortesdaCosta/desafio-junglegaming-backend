import { WalletRepositoryPort } from '../ports/ports';
import { MoneyProps } from '../../domain/money';

export interface GetWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export class GetWalletUseCase {
  constructor(private readonly walletRepo: WalletRepositoryPort) {}

  public async execute(walletId: string): Promise<GetWalletResult | null> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) return null;
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }
}
