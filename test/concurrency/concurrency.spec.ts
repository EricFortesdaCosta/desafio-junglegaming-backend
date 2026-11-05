import { describe, expect, it, beforeEach } from 'bun:test';
import { v4 as uuidv4 } from 'uuid';
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
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
} from '../../src/domain/wager-transaction';
import { Money } from '../../src/domain/money';

describe('High-Concurrency & Race Condition Tests', () => {
  let unitOfWork: InMemoryUnitOfWork;
  let walletRepo: InMemoryWalletRepository;
  let transactionRepo: InMemoryWagerTransactionRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let outboxRepo: InMemoryOutboxRepository;
  let inboxRepo: InMemoryInboxRepository;

  let createWalletUseCase: CreateWalletUseCase;
  let processTxUseCase: ProcessWagerTransactionUseCase;
  let reconcileWalletUseCase: ReconcileWalletUseCase;

  beforeEach(() => {
    unitOfWork = new InMemoryUnitOfWork();
    walletRepo = new InMemoryWalletRepository();
    transactionRepo = new InMemoryWagerTransactionRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    outboxRepo = new InMemoryOutboxRepository();
    inboxRepo = new InMemoryInboxRepository();

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

  it('CENÁRIO OBRIGATÓRIO (Seção 8): Saldo 100.00 BRL, duas apostas de 80.00 BRL em paralelo', async () => {
    // 1. Criar wallet com 100.00 BRL
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-mandatory',
      initialBalance: { amount: '100.00', currency: 'BRL' },
    });

    // 2. Disparar simultaneamente duas apostas de 80.00 BRL
    const promise1 = processTxUseCase.execute({
      idempotencyKey: 'provider-a:bet-1',
      providerId: 'provider-a',
      externalTransactionId: 'bet-1',
      playerId: 'player-mandatory',
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-tiger',
      kind: WagerTransactionKind.Bet,
      money: { amount: '80.00', currency: 'BRL' },
    });

    const promise2 = processTxUseCase.execute({
      idempotencyKey: 'provider-a:bet-2',
      providerId: 'provider-a',
      externalTransactionId: 'bet-2',
      playerId: 'player-mandatory',
      walletId: wallet.id,
      roundId: 'round-2',
      gameId: 'fortune-tiger',
      kind: WagerTransactionKind.Bet,
      money: { amount: '80.00', currency: 'BRL' },
    });

    const [res1, res2] = await Promise.all([promise1, promise2]);

    // 3. Validação estrita dos requisitos da Seção 8:
    // - exatamente uma aposta PROCESSED;
    // - a outra REJECTED por saldo insuficiente;
    const processed = [res1, res2].filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = [res1, res2].filter((r) => r.status === WagerTransactionStatus.Rejected);

    expect(processed.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].failureCode).toBe(FailureCode.InsufficientFunds);

    // - saldo final 20.00 BRL
    const updatedWallet = await walletRepo.findById(wallet.id);
    expect(updatedWallet?.balance.toString()).toBe('20.00');

    // - exatamente um lançamento de débito no ledger
    const reconciliation = await reconcileWalletUseCase.execute(wallet.id);
    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance.amount).toBe('20.00');
    expect(reconciliation.calculatedBalance.amount).toBe('20.00');
    expect(reconciliation.difference.amount).toBe('0.00');

    // Total de entradas: 1 OPENING credit (100.00) + 1 BET debit (80.00) = 2
    expect(reconciliation.checkedEntries).toBe(2);
  });

  it('50 apostas simultâneas com a MESMA Idempotency-Key -> exatamente 1 débito e 49 replays', async () => {
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-idemp-50',
      initialBalance: { amount: '500.00', currency: 'BRL' },
    });

    const idempotencyKey = 'provider-x:unique-round-key';
    const promises = Array.from({ length: 50 }, () =>
      processTxUseCase.execute({
        idempotencyKey,
        providerId: 'provider-x',
        externalTransactionId: 'unique-round-key',
        playerId: 'player-idemp-50',
        walletId: wallet.id,
        roundId: 'round-idemp',
        gameId: 'sweet-bonanza',
        kind: WagerTransactionKind.Bet,
        money: { amount: '10.00', currency: 'BRL' },
      }),
    );

    const results = await Promise.all(promises);

    const firstTime = results.filter((r) => r.idempotentReplay === false);
    const replays = results.filter((r) => r.idempotentReplay === true);

    expect(firstTime.length).toBe(1);
    expect(replays.length).toBe(49);

    // O saldo deve ter sido debitado exatamente uma vez: 500.00 - 10.00 = 490.00
    const finalWallet = await walletRepo.findById(wallet.id);
    expect(finalWallet?.balance.toString()).toBe('490.00');

    // Reconciliação do ledger confirma consistência absoluta
    const rec = await reconcileWalletUseCase.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.storedBalance.amount).toBe('490.00');
  });

  it('50 apostas DIFERENTES simultâneas em paralelo disputando a mesma carteira', async () => {
    // Saldo: 250.00 BRL. Cada aposta é de 10.00 BRL.
    // 50 apostas x 10.00 = 500.00 BRL.
    // Devem passar exatamente 25 apostas e falhar exatamente 25 apostas por falta de saldo.
    const wallet = await createWalletUseCase.execute({
      playerId: 'player-50-distinct',
      initialBalance: { amount: '250.00', currency: 'BRL' },
    });

    const promises = Array.from({ length: 50 }, (_, i) =>
      processTxUseCase.execute({
        idempotencyKey: `provider-test:bet-${i}`,
        providerId: 'provider-test',
        externalTransactionId: `bet-${i}`,
        playerId: 'player-50-distinct',
        walletId: wallet.id,
        roundId: `round-${i}`,
        gameId: 'gates-of-olympus',
        kind: WagerTransactionKind.Bet,
        money: { amount: '10.00', currency: 'BRL' },
      }),
    );

    const results = await Promise.all(promises);

    const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);

    expect(processed.length).toBe(25);
    expect(rejected.length).toBe(25);

    // Saldo final deve ser exatamente 0.00
    const finalWallet = await walletRepo.findById(wallet.id);
    expect(finalWallet?.balance.toString()).toBe('0.00');

    // Invariante final de todos os testes: wallet.balance == saldo reconstruído pelo ledger
    const rec = await reconcileWalletUseCase.execute(wallet.id);
    expect(rec.consistent).toBe(true);
    expect(rec.storedBalance.amount).toBe('0.00');
    expect(rec.calculatedBalance.amount).toBe('0.00');
  });
});
