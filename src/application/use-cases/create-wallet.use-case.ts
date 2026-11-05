import { v4 as uuidv4 } from 'uuid';
import { Money, MoneyProps } from '../../domain/money';
import { Wallet } from '../../domain/wallet';
import {
  WagerTransaction,
  WagerTransactionKind,
  LedgerDirection,
  computeCanonicalPayloadHash,
} from '../../domain/wager-transaction';
import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/outbox-message';
import { WalletBalanceChanged } from '../../domain/events/integration-event';
import {
  WalletRepositoryPort,
  WagerTransactionRepositoryPort,
  LedgerRepositoryPort,
  OutboxRepositoryPort,
  UnitOfWorkPort,
} from '../ports/ports';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export class CreateWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly walletRepo: WalletRepositoryPort,
    private readonly transactionRepo: WagerTransactionRepositoryPort,
    private readonly ledgerRepo: LedgerRepositoryPort,
    private readonly outboxRepo: OutboxRepositoryPort,
  ) {}

  public async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    const initialMoney = Money.from(command.initialBalance);

    return this.unitOfWork.runInTransaction(async (trx) => {
      const existing = await this.walletRepo.findByPlayerAndCurrency(
        command.playerId,
        initialMoney.currency,
        trx,
      );

      if (existing) {
        throw new Error(`Wallet already exists for player ${command.playerId} and currency ${initialMoney.currency}`);
      }

      const walletId = uuidv4();
      const wallet = Wallet.open({
        id: walletId,
        playerId: command.playerId,
        initialBalance: initialMoney,
      });

      await this.walletRepo.save(wallet, trx);

      if (initialMoney.isPositive()) {
        const txId = uuidv4();
        const payloadHash = computeCanonicalPayloadHash({
          action: 'OPENING',
          walletId,
          amount: initialMoney.toString(),
          currency: initialMoney.currency,
        });

        const openingTx = WagerTransaction.create({
          id: txId,
          providerId: 'INTERNAL',
          externalTransactionId: `opening-${walletId}`,
          idempotencyKey: `internal:opening:${walletId}`,
          payloadHash,
          walletId,
          playerId: command.playerId,
          roundId: 'opening-round',
          gameId: 'system',
          kind: WagerTransactionKind.Opening,
          money: initialMoney,
        });

        openingTx.markProcessed(undefined);
        await this.transactionRepo.save(openingTx, trx);

        const zero = Money.zero(initialMoney.currency);
        const ledgerEntry = WalletLedgerEntry.create({
          id: uuidv4(),
          walletId,
          transactionId: txId,
          direction: LedgerDirection.Credit,
          money: initialMoney,
          balanceBefore: zero,
          balanceAfter: initialMoney,
        });

        await this.ledgerRepo.save(ledgerEntry, trx);

        const balanceChangedEvent = WalletBalanceChanged.create({
          eventId: uuidv4(),
          aggregateId: walletId,
          correlationId: `wallet-open-${walletId}`,
          data: {
            walletId,
            transactionId: txId,
            direction: LedgerDirection.Credit,
            money: initialMoney.toJSON(),
            balanceBefore: zero.toJSON(),
            balanceAfter: initialMoney.toJSON(),
            walletVersion: wallet.version,
          },
        });

        await this.outboxRepo.save(OutboxMessage.enqueue(balanceChangedEvent), trx);
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
