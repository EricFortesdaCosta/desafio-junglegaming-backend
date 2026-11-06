import {
  WagerTransactionRepositoryPort,
  WalletRepositoryPort,
  OutboxRepositoryPort,
  UnitOfWorkPort,
} from '../../application/ports/ports';
import { FailureCode, WagerTransactionStatus } from '../../domain/wager-transaction';
import { OutboxMessage } from '../../domain/outbox-message';
import { WagerTransactionRejected } from '../../domain/events/integration-event';
import { v4 as uuidv4 } from 'uuid';

export class PendingReferenceResolverWorker {
  private isRunning = false;
  private timer: Timer | null = null;

  constructor(
    private readonly transactionRepo: WagerTransactionRepositoryPort,
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly ttlMs: number = 60000, // 60s TTL for missing references
    private readonly pollIntervalMs: number = 2000,
  ) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => this.resolvePendingReferences(), this.pollIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async resolvePendingReferences(): Promise<number> {
    const pendingList = await this.transactionRepo.findPendingReferences(20);
    const now = new Date();
    let resolvedCount = 0;

    for (const pendingTx of pendingList) {
      const ageMs = now.getTime() - pendingTx.createdAt.getTime();

      // Check if reference transaction has now arrived
      const ref = pendingTx.referenceExternalTransactionId
        ? await this.transactionRepo.findByExternalId(
            pendingTx.providerId,
            pendingTx.referenceExternalTransactionId,
          )
        : null;

      if (ref && ref.status === WagerTransactionStatus.Processed) {
        // Reference has arrived! Mark processed
        await this.unitOfWork.runInTransaction(async (trx) => {
          pendingTx.markProcessed(ref.id, now);
          await this.transactionRepo.save(pendingTx, trx);
        });
        resolvedCount++;
      } else if (ageMs >= this.ttlMs) {
        // TTL exceeded: transition to REJECTED with ReferenceNotFound
        await this.unitOfWork.runInTransaction(async (trx) => {
          pendingTx.reject(FailureCode.ReferenceNotFound);
          await this.transactionRepo.save(pendingTx, trx);

          const event = WagerTransactionRejected.create({
            eventId: uuidv4(),
            aggregateId: pendingTx.id,
            correlationId: pendingTx.idempotencyKey,
            data: {
              transactionId: pendingTx.id,
              walletId: pendingTx.walletId,
              providerId: pendingTx.providerId,
              externalTransactionId: pendingTx.externalTransactionId,
              failureCode: FailureCode.ReferenceNotFound,
              reason: 'Referenced transaction was not found within TTL window',
            },
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(event), trx);
        });
        resolvedCount++;
      }
    }

    return resolvedCount;
  }
}

