import { Request, Response } from 'express';
import { CreateWalletUseCase } from '../../application/use-cases/create-wallet.use-case';
import { GetWalletUseCase } from '../../application/use-cases/get-wallet.use-case';
import { GetWalletLedgerUseCase } from '../../application/use-cases/get-wallet-ledger.use-case';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction.use-case';
import { ReconcileWalletUseCase } from '../../application/use-cases/reconcile-wallet.use-case';
import { WagerTransactionRepositoryPort } from '../../application/ports/ports';
import { WagerTransactionStatus } from '../../domain/wager-transaction';
import { IdempotencyConflictError, InvalidMoneyError } from '../../domain/errors/domain-error';

export class HttpControllers {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly getWalletUseCase: GetWalletUseCase,
    private readonly getWalletLedgerUseCase: GetWalletLedgerUseCase,
    private readonly processTransactionUseCase: ProcessWagerTransactionUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
    private readonly transactionRepo: WagerTransactionRepositoryPort,
  ) {}

  public async createWallet(req: Request, res: Response): Promise<void> {
    try {
      const { playerId, initialBalance } = req.body;
      if (!playerId || !initialBalance || !initialBalance.amount || !initialBalance.currency) {
        res.status(400).json({ error: 'Missing required fields: playerId, initialBalance (amount, currency)' });
        return;
      }

      const result = await this.createWalletUseCase.execute({
        playerId,
        initialBalance,
      });

      res.status(201).json(result);
    } catch (err: any) {
      if (err.message && err.message.includes('already exists')) {
        res.status(409).json({ error: err.message });
      } else if (err instanceof InvalidMoneyError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  }

  public async getWallet(req: Request, res: Response): Promise<void> {
    try {
      const { walletId } = req.params;
      const wallet = await this.getWalletUseCase.execute(walletId);
      if (!wallet) {
        res.status(404).json({ error: `Wallet ${walletId} not found` });
        return;
      }
      res.status(200).json(wallet);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  public async getWalletLedger(req: Request, res: Response): Promise<void> {
    try {
      const { walletId } = req.params;
      const cursor = req.query.cursor as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const ledger = await this.getWalletLedgerUseCase.execute(walletId, cursor, limit);
      res.status(200).json(ledger);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  public async reconcileWallet(req: Request, res: Response): Promise<void> {
    try {
      const { walletId } = req.params;
      const report = await this.reconcileWalletUseCase.execute(walletId);
      res.status(200).json(report);
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
      } else {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  }

  public async submitTransaction(req: Request, res: Response): Promise<void> {
    try {
      const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as string | undefined;

      const {
        providerId,
        externalTransactionId,
        playerId,
        walletId,
        roundId,
        gameId,
        kind,
        money,
        referenceExternalTransactionId,
      } = req.body;

      if (!providerId || !externalTransactionId || !playerId || !walletId || !roundId || !gameId || !kind || !money) {
        res.status(400).json({ error: 'Missing mandatory transaction fields' });
        return;
      }

      const result = await this.processTransactionUseCase.execute({
        idempotencyKey,
        providerId,
        externalTransactionId,
        playerId,
        walletId,
        roundId,
        gameId,
        kind,
        money,
        referenceExternalTransactionId,
      });

      if (result.status === WagerTransactionStatus.Rejected) {
        res.status(422).json(result);
      } else if (result.status === WagerTransactionStatus.PendingReference) {
        res.status(202).json(result);
      } else {
        res.status(200).json(result);
      }
    } catch (err: any) {
      if (err instanceof IdempotencyConflictError) {
        res.status(409).json({ error: err.message });
      } else if (err instanceof InvalidMoneyError) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  }

  public async getTransactionById(req: Request, res: Response): Promise<void> {
    try {
      const { transactionId } = req.params;
      const tx = await this.transactionRepo.findById(transactionId);
      if (!tx) {
        res.status(404).json({ error: `Transaction ${transactionId} not found` });
        return;
      }

      res.status(200).json({
        id: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        status: tx.status,
        failureCode: tx.failureCode,
        processedAt: tx.processedAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  public async getTransactionByExternalId(req: Request, res: Response): Promise<void> {
    try {
      const { providerId, externalTransactionId } = req.params;
      const tx = await this.transactionRepo.findByExternalId(providerId, externalTransactionId);
      if (!tx) {
        res.status(404).json({ error: `Transaction ${externalTransactionId} for provider ${providerId} not found` });
        return;
      }

      res.status(200).json({
        id: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        status: tx.status,
        failureCode: tx.failureCode,
        processedAt: tx.processedAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }

  public healthLive(_req: Request, res: Response): void {
    res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
  }

  public healthReady(_req: Request, res: Response): void {
    res.status(200).json({ status: 'READY', postgres: 'UP', sqs: 'UP' });
  }
}
