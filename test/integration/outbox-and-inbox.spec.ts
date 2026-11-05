import { describe, expect, it, beforeEach } from 'bun:test';
import {
  InMemoryUnitOfWork,
  InMemoryWalletRepository,
  InMemoryWagerTransactionRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryInboxRepository,
} from '../../src/infrastructure/database/in-memory-repositories';
import { CreateWalletUseCase } from '../../src/application/use-cases/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/process-wager-transaction.use-case';
import { ReconcileWalletUseCase } from '../../src/application/use-cases/reconcile-wallet.use-case';
import { MockMessagePublisher } from '../../src/infrastructure/messaging/sqs-client';
import { OutboxPublisherWorker } from '../../src/infrastructure/workers/outbox-publisher.worker';
import { PendingReferenceResolverWorker } from '../../src/infrastructure/workers/pending-reference-resolver.worker';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../src/domain/wager-transaction';
import { IdempotencyConflictError } from '../../src/domain/errors/domain-error';

describe('Transactional Outbox, Deduplication and Out-of-Order Execution Tests', () => {
  let unitOfWork: InMemoryUnitOfWork;
  let walletRepo: InMemoryWalletRepository;
  let transactionRepo: InMemoryWagerTransactionRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let inboxRepo: InMemoryInboxRepository;

  let createWalletUseCase: CreateWalletUseCase;
  let processTxUseCase: ProcessWagerTransactionUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;
  let mockPublisher: MockMessagePublisher;

  beforeEach(() => {
    unitOfWork = new InMemoryUnitOfWork();
    walletRepo = new InMemoryWalletRepository();
    transactionRepo = new InMemoryWagerTransactionRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    outboxRepo = new InMemoryOutboxRepository();
    inboxRepo = new InMemoryInboxRepository();
    mockPublisher = new MockMessagePublisher();

    createWalletUseCase = new CreateWalletUseCase(
      unitOfWork,
      walletRepo,
      transactionRepo,
      ledgerRepo,
      outboxRepo,
    );

    processTxUseCase = new ProcessWagerTransactionUseCase(
      unitOfWork,
      walletRepo,
      transactionRepo,
      ledgerRepo,
      outboxRepo,
      inboxRepo,
    );

    reconcileWalletUseCase = new ReconcileWalletUseCase(walletRepo, ledgerRepo);
  });

  it('guarantees atomic outbox recording and worker publishing', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-outbox-1',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    await processTxUseCase.execute({
      idempotencyKey: 'prov:tx-100',
      providerId: 'prov',
      externalTransactionId: 'tx-100',
      playerId: 'player-outbox-1',
      walletId: wallet.id,
      roundId: 'r-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '30.00', currency: 'BRL' },
    });

    const outboxMessages = outboxRepo.getAllMessages();
    // 1 from wallet opening + 2 from bet (WalletBalanceChanged + WagerTransactionProcessed) = 3 messages
    expect(outboxMessages.length).toBe(3);

    const worker = new OutboxPublisherWorker(outboxRepo, mockPublisher);
    const publishedCount = await worker.processDueMessages();
    expect(publishedCount).toBe(3);
    expect(mockPublisher.published.length).toBe(3);

    // After publishing, isPending should be false
    for (const msg of outboxMessages) {
      expect(msg.isPending()).toBe(false);
      expect(msg.publishedAt).toBeDefined();
    }
  });

  it('handles out-of-order REFUND delivered BEFORE the BET transaction', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-ooo',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    // 1. REFUND arrives before BET
    const refundResult = await processTxUseCase.execute({
      idempotencyKey: 'prov:refund-1',
      providerId: 'prov',
      externalTransactionId: 'refund-1',
      playerId: 'player-ooo',
      walletId: wallet.id,
      roundId: 'round-ooo',
      gameId: 'game-ooo',
      kind: WagerTransactionKind.Refund,
      money: { amount: '20.00', currency: 'BRL' },
      referenceExternalTransactionId: 'bet-orig-1',
    });

    expect(refundResult.status).toBe(WagerTransactionStatus.PendingReference);

    // Saldo da wallet não deve ser afetado enquanto a referência estiver pendente
    let currentWallet = await walletRepo.findById(wallet.id);
    expect(currentWallet?.balance.toString()).toBe('100.00');

    // 2. BET original chega e é processada
    const betResult = await processTxUseCase.execute({
      idempotencyKey: 'prov:bet-orig-1',
      providerId: 'prov',
      externalTransactionId: 'bet-orig-1',
      playerId: 'player-ooo',
      walletId: wallet.id,
      roundId: 'round-ooo',
      gameId: 'game-ooo',
      kind: WagerTransactionKind.Bet,
      money: { amount: '20.00', currency: 'BRL' },
    });

    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
    currentWallet = await walletRepo.findById(wallet.id);
    expect(currentWallet?.balance.toString()).toBe('80.00');

    // 3. Worker agendado roda para resolver referências pendentes
    const resolver = new PendingReferenceResolverWorker(
      transactionRepo,
      outboxRepo,
      unitOfWork,
      60000,
    );

    const resolvedCount = await resolver.resolvePendingReferences();
    expect(resolvedCount).toBe(1);

    const updatedRefund = await transactionRepo.findByExternalId('prov', 'refund-1');
    expect(updatedRefund?.status).toBe(WagerTransactionStatus.Processed);
    expect(updatedRefund?.referenceTransactionId).toBe(betResult.transactionId);
  });

  it('rejects duplicate idempotency key with conflicting payload (409 Conflict)', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-conflict',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    await processTxUseCase.execute({
      idempotencyKey: 'key-fixed',
      providerId: 'p1',
      externalTransactionId: 'tx-orig',
      playerId: 'player-conflict',
      walletId: wallet.id,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '15.00', currency: 'BRL' },
    });

    // Reenvia com a MESMA chave porém com valor diferente (30.00)
    expect(
      processTxUseCase.execute({
        idempotencyKey: 'key-fixed',
        providerId: 'p1',
        externalTransactionId: 'tx-orig',
        playerId: 'player-conflict',
        walletId: wallet.id,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '30.00', currency: 'BRL' }, // divergência proposital!
      }),
    ).rejects.toThrow(IdempotencyConflictError);
  });
});
