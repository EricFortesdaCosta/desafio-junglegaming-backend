import express, { Express, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { HttpControllers } from './interfaces/http/controllers';
import { CreateWalletUseCase } from './application/use-cases/create-wallet.use-case';
import { GetWalletUseCase } from './application/use-cases/get-wallet.use-case';
import { GetWalletLedgerUseCase } from './application/use-cases/get-wallet-ledger.use-case';
import { ProcessWagerTransactionUseCase } from './application/use-cases/process-wager-transaction.use-case';
import { ReconcileWalletUseCase } from './application/use-cases/reconcile-wallet.use-case';
import {
  WalletRepositoryPort,
  WagerTransactionRepositoryPort,
  LedgerRepositoryPort,
  OutboxRepositoryPort,
  InboxRepositoryPort,
  UnitOfWorkPort,
} from './application/ports/ports';

export function createExpressApp(dependencies: {
  unitOfWork: UnitOfWorkPort;
  walletRepo: WalletRepositoryPort;
  transactionRepo: WagerTransactionRepositoryPort;
  ledgerRepo: LedgerRepositoryPort;
  outboxRepo: OutboxRepositoryPort;
  inboxRepo: InboxRepositoryPort;
}): Express {
  const app = express();
  app.use(express.json());

  // Structured Logging Middleware with Correlation ID
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const logEntry = {
        timestamp: new Date().toISOString(),
        correlationId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      };
      // Structured JSON log without logging sensitive tokens or full money payloads
      console.log(JSON.stringify(logEntry));
    });

    next();
  });

  const createWalletUseCase = new CreateWalletUseCase(
    dependencies.unitOfWork,
    dependencies.walletRepo,
    dependencies.transactionRepo,
    dependencies.ledgerRepo,
    dependencies.outboxRepo,
  );

  const getWalletUseCase = new GetWalletUseCase(dependencies.walletRepo);
  const getWalletLedgerUseCase = new GetWalletLedgerUseCase(dependencies.ledgerRepo);

  const processTransactionUseCase = new ProcessWagerTransactionUseCase(
    dependencies.unitOfWork,
    dependencies.walletRepo,
    dependencies.transactionRepo,
    dependencies.ledgerRepo,
    dependencies.outboxRepo,
    dependencies.inboxRepo,
  );

  const reconcileWalletUseCase = new ReconcileWalletUseCase(
    dependencies.walletRepo,
    dependencies.ledgerRepo,
  );

  const controllers = new HttpControllers(
    createWalletUseCase,
    getWalletUseCase,
    getWalletLedgerUseCase,
    processTransactionUseCase,
    reconcileWalletUseCase,
    dependencies.transactionRepo,
  );

  // Health checks
  app.get('/health/live', (req, res) => controllers.healthLive(req, res));
  app.get('/health/ready', (req, res) => controllers.healthReady(req, res));

  // Wallets
  app.post('/wallets', (req, res) => controllers.createWallet(req, res));
  app.get('/wallets/:walletId', (req, res) => controllers.getWallet(req, res));
  app.get('/wallets/:walletId/ledger', (req, res) => controllers.getWalletLedger(req, res));
  app.post('/wallets/:walletId/reconciliation', (req, res) => controllers.reconcileWallet(req, res));

  // Wagering Transactions
  app.post('/wagering/transactions', (req, res) => controllers.submitTransaction(req, res));
  app.get('/wagering/transactions/:transactionId', (req, res) => controllers.getTransactionById(req, res));
  app.get(
    '/providers/:providerId/wagering/transactions/:externalTransactionId',
    (req, res) => controllers.getTransactionByExternalId(req, res),
  );

  return app;
}

