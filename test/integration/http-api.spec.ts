import { describe, expect, it, beforeEach } from 'bun:test';
import { createExpressApp } from '../../src/app';
import {
  InMemoryUnitOfWork,
  InMemoryWalletRepository,
  InMemoryWagerTransactionRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryInboxRepository,
} from '../../src/infrastructure/database/in-memory-repositories';
import { Express } from 'express';

describe('HTTP API End-to-End Tests', () => {
  let app: Express;
  let server: any;
  let baseUrl: string;

  beforeEach(async () => {
    const unitOfWork = new InMemoryUnitOfWork();
    const walletRepo = new InMemoryWalletRepository();
    const transactionRepo = new InMemoryWagerTransactionRepository();
    const ledgerRepo = new InMemoryLedgerRepository();
    const outboxRepo = new InMemoryOutboxRepository();
    const inboxRepo = new InMemoryInboxRepository();

    app = createExpressApp({
      unitOfWork,
      walletRepo,
      transactionRepo,
      ledgerRepo,
      outboxRepo,
      inboxRepo,
    });

    const port = 30000 + Math.floor(Math.random() * 5000);
    baseUrl = `http://127.0.0.1:${port}`;
    await new Promise((resolve) => {
      server = app.listen(port, '127.0.0.1', () => resolve(true));
    });
  });

  it('performs full wagering lifecycle via HTTP', async () => {
    try {
      // 1. Health check
      const liveRes = await fetch(`${baseUrl}/health/live`);
      expect(liveRes.status).toBe(200);

      // 2. Create wallet
      const createWalletRes = await fetch(`${baseUrl}/wallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: 'player-http-1',
          initialBalance: { amount: '100.00', currency: 'BRL' },
        }),
      });

      expect(createWalletRes.status).toBe(201);
      const wallet = await createWalletRes.json();
      expect(wallet.id).toBeDefined();
      expect(wallet.balance.amount).toBe('100.00');

      // 3. Submit BET
      const betRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'http-provider:tx-1',
        },
        body: JSON.stringify({
          providerId: 'http-provider',
          externalTransactionId: 'tx-1',
          playerId: 'player-http-1',
          walletId: wallet.id,
          roundId: 'round-http-1',
          gameId: 'gates-of-olympus',
          kind: 'BET',
          money: { amount: '40.00', currency: 'BRL' },
        }),
      });

      expect(betRes.status).toBe(200);
      const betData = await betRes.json();
      expect(betData.status).toBe('PROCESSED');
      expect(betData.balance.amount).toBe('60.00');
      expect(betData.idempotentReplay).toBe(false);

      // 4. Replay the same BET -> idempotentReplay: true, same balance
      const replayRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'http-provider:tx-1',
        },
        body: JSON.stringify({
          providerId: 'http-provider',
          externalTransactionId: 'tx-1',
          playerId: 'player-http-1',
          walletId: wallet.id,
          roundId: 'round-http-1',
          gameId: 'gates-of-olympus',
          kind: 'BET',
          money: { amount: '40.00', currency: 'BRL' },
        }),
      });

      expect(replayRes.status).toBe(200);
      const replayData = await replayRes.json();
      expect(replayData.idempotentReplay).toBe(true);
      expect(replayData.balance.amount).toBe('60.00');

      // 5. Submit WIN of 80.00 BRL
      const winRes = await fetch(`${baseUrl}/wagering/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'http-provider:tx-2',
        },
        body: JSON.stringify({
          providerId: 'http-provider',
          externalTransactionId: 'tx-2',
          playerId: 'player-http-1',
          walletId: wallet.id,
          roundId: 'round-http-1',
          gameId: 'gates-of-olympus',
          kind: 'WIN',
          money: { amount: '80.00', currency: 'BRL' },
        }),
      });

      expect(winRes.status).toBe(200);
      const winData = await winRes.json();
      expect(winData.balance.amount).toBe('140.00');

      // 6. Query Ledger
      const ledgerRes = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger`);
      expect(ledgerRes.status).toBe(200);
      const ledgerData = await ledgerRes.json();
      // 1 OPENING + 1 BET + 1 WIN = 3 entries
      expect(ledgerData.items.length).toBe(3);

      // 7. Reconcile wallet
      const recRes = await fetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, {
        method: 'POST',
      });
      expect(recRes.status).toBe(200);
      const recData = await recRes.json();
      expect(recData.consistent).toBe(true);
      expect(recData.storedBalance.amount).toBe('140.00');
      expect(recData.calculatedBalance.amount).toBe('140.00');
      expect(recData.difference.amount).toBe('0.00');
    } finally {
      server.close();
    }
  });
});

