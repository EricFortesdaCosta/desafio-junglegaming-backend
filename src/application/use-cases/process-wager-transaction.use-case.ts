import { v4 as uuidv4 } from 'uuid';
import { Money, MoneyProps } from '../../domain/money';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
  LedgerDirection,
  computeCanonicalPayloadHash,
} from '../../domain/wager-transaction';
import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/outbox-message';
import { InboxMessage } from '../../domain/inbox-message';
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
} from '../../domain/events/integration-event';
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  CurrencyMismatchError,
} from '../../domain/errors/domain-error';
import {
  WalletRepositoryPort,
  WagerTransactionRepositoryPort,
  LedgerRepositoryPort,
  OutboxRepositoryPort,
  InboxRepositoryPort,
  UnitOfWorkPort,
} from '../ports/ports';

export interface ProcessWagerTransactionCommand {
  idempotencyKey?: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  sqsMessageId?: string;
}

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly walletRepo: WalletRepositoryPort,
    private readonly transactionRepo: WagerTransactionRepositoryPort,
    private readonly ledgerRepo: LedgerRepositoryPort,
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly inboxRepo: InboxRepositoryPort,
  ) {}

  public async execute(command: ProcessWagerTransactionCommand): Promise<ProcessWagerTransactionResult> {
    const idempotencyKey =
      command.idempotencyKey ?? `${command.providerId}:${command.externalTransactionId}`;

    const parsedMoney = Money.from(command.money);

    // Compute canonical payload hash based strictly on domain fields
    const payloadHash = computeCanonicalPayloadHash({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: {
        amount: parsedMoney.toString(),
        currency: parsedMoney.currency,
      },
      referenceExternalTransactionId: command.referenceExternalTransactionId ?? null,
    });

    // 1. Fast pre-check outside transaction
    const existingTx =
      (await this.transactionRepo.findByIdempotencyKey(idempotencyKey)) ??
      (await this.transactionRepo.findByExternalId(command.providerId, command.externalTransactionId));

    if (existingTx) {
      if (!existingTx.matchesPayload(payloadHash)) {
        throw new IdempotencyConflictError(
          `Idempotency conflict: key '${idempotencyKey}' already used with different payload`,
        );
      }

      // Replay original result
      const wallet = await this.walletRepo.findById(existingTx.walletId);
      return {
        transactionId: existingTx.id,
        status: existingTx.status,
        balance: wallet ? wallet.balance.toJSON() : parsedMoney.toJSON(),
        idempotentReplay: true,
        failureCode: existingTx.failureCode,
      };
    }

    // 2. Execute business transaction within transactional unit of work
    return this.unitOfWork.runInTransaction(async (trx) => {
      // Re-verify idempotency inside transaction lock to serialize concurrent identical requests
      const existingInTrx =
        (await this.transactionRepo.findByIdempotencyKey(idempotencyKey, trx)) ??
        (await this.transactionRepo.findByExternalId(command.providerId, command.externalTransactionId, trx));

      if (existingInTrx) {
        if (!existingInTrx.matchesPayload(payloadHash)) {
          throw new IdempotencyConflictError(
            `Idempotency conflict: key '${idempotencyKey}' already used with different payload`,
          );
        }

        const wallet = await this.walletRepo.findById(existingInTrx.walletId, trx);
        return {
          transactionId: existingInTrx.id,
          status: existingInTrx.status,
          balance: wallet ? wallet.balance.toJSON() : parsedMoney.toJSON(),
          idempotentReplay: true,
          failureCode: existingInTrx.failureCode,
        };
      }
      // Deduplicate SQS message if arriving through SQS
      if (command.sqsMessageId) {
        const existingInbox = await this.inboxRepo.findByConsumerAndMessageId(
          'wager-consumer',
          command.sqsMessageId,
          trx,
        );
        if (existingInbox && existingInbox.isProcessed()) {
          const wallet = await this.walletRepo.findById(command.walletId, trx);
          return {
            transactionId: existingTx ? existingTx.id : 'replayed-inbox',
            status: WagerTransactionStatus.Processed,
            balance: wallet ? wallet.balance.toJSON() : parsedMoney.toJSON(),
            idempotentReplay: true,
          };
        }
      }

      // Acquire exclusive row-level lock on the target wallet
      const wallet = await this.walletRepo.findByIdForUpdate(command.walletId, trx);
      if (!wallet) {
        throw new Error(`Wallet not found: ${command.walletId}`);
      }

      if (wallet.currency !== parsedMoney.currency) {
        throw new CurrencyMismatchError(wallet.currency, parsedMoney.currency);
      }

      const txId = uuidv4();
      const transaction = WagerTransaction.create({
        id: txId,
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey,
        payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        money: parsedMoney,
        referenceExternalTransactionId: command.referenceExternalTransactionId,
      });

      // 3. Reference resolution for REFUND and ROLLBACK
      let referenceTx: WagerTransaction | null = null;
      if (transaction.requiresReference()) {
        referenceTx = await this.transactionRepo.findByExternalId(
          command.providerId,
          command.referenceExternalTransactionId!,
          trx,
        );

        if (!referenceTx || referenceTx.status !== WagerTransactionStatus.Processed) {
          // Out-of-order scenario: Reference has not arrived yet -> mark PENDING_REFERENCE
          transaction.markPendingReference();
          await this.transactionRepo.save(transaction, trx);

          const pendingEvent = WagerTransactionPendingReference.create({
            eventId: uuidv4(),
            aggregateId: transaction.id,
            correlationId: idempotencyKey,
            data: {
              transactionId: transaction.id,
              walletId: wallet.id,
              providerId: transaction.providerId,
              externalTransactionId: transaction.externalTransactionId,
              referenceExternalTransactionId: command.referenceExternalTransactionId!,
            },
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(pendingEvent), trx);

          return {
            transactionId: transaction.id,
            status: WagerTransactionStatus.PendingReference,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        }

        // Validate reference consistency
        if (
          referenceTx.playerId !== command.playerId ||
          referenceTx.walletId !== command.walletId ||
          referenceTx.roundId !== command.roundId ||
          !referenceTx.money.equals(parsedMoney)
        ) {
          transaction.reject(FailureCode.RoundMismatch);
          await this.transactionRepo.save(transaction, trx);
          return {
            transactionId: transaction.id,
            status: WagerTransactionStatus.Rejected,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
            failureCode: FailureCode.RoundMismatch,
          };
        }
      }

      // 4. Apply financial movement based on transaction kind
      let ledgerDirection: LedgerDirection | null = null;
      let balanceBefore: Money = wallet.balance;
      let balanceAfter: Money = wallet.balance;

      try {
        switch (command.kind) {
          case WagerTransactionKind.Bet: {
            if (wallet.balance.isLessThan(parsedMoney)) {
              transaction.reject(FailureCode.InsufficientFunds);
              await this.transactionRepo.save(transaction, trx);

              const rejectedEvent = WagerTransactionRejected.create({
                eventId: uuidv4(),
                aggregateId: transaction.id,
                correlationId: idempotencyKey,
                data: {
                  transactionId: transaction.id,
                  walletId: wallet.id,
                  providerId: transaction.providerId,
                  externalTransactionId: transaction.externalTransactionId,
                  failureCode: FailureCode.InsufficientFunds,
                  reason: 'Insufficient funds for bet',
                },
              });
              await this.outboxRepo.save(OutboxMessage.enqueue(rejectedEvent), trx);

              return {
                transactionId: transaction.id,
                status: WagerTransactionStatus.Rejected,
                balance: wallet.balance.toJSON(),
                idempotentReplay: false,
                failureCode: FailureCode.InsufficientFunds,
              };
            }

            const debitResult = wallet.debit(parsedMoney);
            balanceBefore = debitResult.balanceBefore;
            balanceAfter = debitResult.balanceAfter;
            ledgerDirection = LedgerDirection.Debit;
            break;
          }

          case WagerTransactionKind.Win: {
            const creditResult = wallet.credit(parsedMoney);
            balanceBefore = creditResult.balanceBefore;
            balanceAfter = creditResult.balanceAfter;
            ledgerDirection = LedgerDirection.Credit;
            break;
          }

          case WagerTransactionKind.Refund: {
            const creditResult = wallet.credit(parsedMoney);
            balanceBefore = creditResult.balanceBefore;
            balanceAfter = creditResult.balanceAfter;
            ledgerDirection = LedgerDirection.Credit;
            break;
          }

          case WagerTransactionKind.Rollback: {
            const dir = transaction.ledgerDirectionFor(referenceTx ?? undefined);
            if (dir === LedgerDirection.Credit) {
              const creditResult = wallet.credit(parsedMoney);
              balanceBefore = creditResult.balanceBefore;
              balanceAfter = creditResult.balanceAfter;
              ledgerDirection = LedgerDirection.Credit;
            } else {
              if (wallet.balance.isLessThan(parsedMoney)) {
                transaction.reject(FailureCode.NegativeBalanceReversal);
                await this.transactionRepo.save(transaction, trx);
                return {
                  transactionId: transaction.id,
                  status: WagerTransactionStatus.Rejected,
                  balance: wallet.balance.toJSON(),
                  idempotentReplay: false,
                  failureCode: FailureCode.NegativeBalanceReversal,
                };
              }
              const debitResult = wallet.debit(parsedMoney);
              balanceBefore = debitResult.balanceBefore;
              balanceAfter = debitResult.balanceAfter;
              ledgerDirection = LedgerDirection.Debit;
            }
            break;
          }

          case WagerTransactionKind.Loss: {
            // LOSS does NOT affect balance and produces NO ledger entry
            ledgerDirection = null;
            break;
          }
        }
      } catch (err: unknown) {
        if (err instanceof InsufficientFundsError) {
          transaction.reject(FailureCode.InsufficientFunds);
          await this.transactionRepo.save(transaction, trx);
          return {
            transactionId: transaction.id,
            status: WagerTransactionStatus.Rejected,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
            failureCode: FailureCode.InsufficientFunds,
          };
        }
        throw err;
      }

      // 5. Produce Ledger Entry and Wallet Update if balance changed
      if (ledgerDirection !== null) {
        const ledgerEntry = WalletLedgerEntry.create({
          id: uuidv4(),
          walletId: wallet.id,
          transactionId: transaction.id,
          direction: ledgerDirection,
          money: parsedMoney,
          balanceBefore,
          balanceAfter,
        });

        await this.ledgerRepo.save(ledgerEntry, trx);
        await this.walletRepo.save(wallet, trx);

        const balanceChangedEvent = WalletBalanceChanged.create({
          eventId: uuidv4(),
          aggregateId: wallet.id,
          correlationId: idempotencyKey,
          data: {
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: ledgerDirection,
            money: parsedMoney.toJSON(),
            balanceBefore: balanceBefore.toJSON(),
            balanceAfter: balanceAfter.toJSON(),
            walletVersion: wallet.version,
          },
        });
        await this.outboxRepo.save(OutboxMessage.enqueue(balanceChangedEvent), trx);
      }

      // 6. Transition transaction to PROCESSED
      transaction.markProcessed(referenceTx ? referenceTx.id : undefined);
      await this.transactionRepo.save(transaction, trx);

      const processedEvent = WagerTransactionProcessed.create({
        eventId: uuidv4(),
        aggregateId: transaction.id,
        correlationId: idempotencyKey,
        data: {
          transactionId: transaction.id,
          walletId: wallet.id,
          providerId: transaction.providerId,
          externalTransactionId: transaction.externalTransactionId,
          kind: transaction.kind,
          money: parsedMoney.toJSON(),
          balance: wallet.balance.toJSON(),
        },
      });
      await this.outboxRepo.save(OutboxMessage.enqueue(processedEvent), trx);

      // 7. Save Inbox Deduplication record if applicable
      if (command.sqsMessageId) {
        const inboxMsg = InboxMessage.receive({
          messageId: command.sqsMessageId,
          consumerName: 'wager-consumer',
          payloadHash,
        });
        inboxMsg.markProcessed();
        await this.inboxRepo.save(inboxMsg, trx);
      }

      return {
        transactionId: transaction.id,
        status: WagerTransactionStatus.Processed,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    });
  }
}
