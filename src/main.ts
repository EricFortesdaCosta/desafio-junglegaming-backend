import { Pool } from 'pg';
import { createExpressApp } from './app';
import {
  PgUnitOfWork,
  PgWalletRepository,
  PgWagerTransactionRepository,
  PgLedgerRepository,
  PgOutboxRepository,
  PgInboxRepository,
} from './infrastructure/database/pg-repositories';
import {
  InMemoryUnitOfWork,
  InMemoryWalletRepository,
  InMemoryWagerTransactionRepository,
  InMemoryLedgerRepository,
  InMemoryOutboxRepository,
  InMemoryInboxRepository,
} from './infrastructure/database/in-memory-repositories';
import { SqsMessagePublisher, MockMessagePublisher } from './infrastructure/messaging/sqs-client';
import { OutboxPublisherWorker } from './infrastructure/workers/outbox-publisher.worker';
import { PendingReferenceResolverWorker } from './infrastructure/workers/pending-reference-resolver.worker';

async function bootstrap() {
  const port = process.env.PORT || 3000;
  const dbUrl = process.env.DATABASE_URL;

  let unitOfWork;
  let walletRepo;
  let transactionRepo;
  let ledgerRepo;
  let outboxRepo;
  let inboxRepo;
  let publisher;

  if (dbUrl) {
    console.log(`[BOOTSTRAP] Initializing PostgreSQL connection pool with ${dbUrl}...`);
    const pool = new Pool({ connectionString: dbUrl });
    unitOfWork = new PgUnitOfWork(pool);
    walletRepo = new PgWalletRepository(pool);
    transactionRepo = new PgWagerTransactionRepository(pool);
    ledgerRepo = new PgLedgerRepository(pool);
    outboxRepo = new PgOutboxRepository(pool);
    inboxRepo = new PgInboxRepository(pool);
    publisher = new SqsMessagePublisher();
  } else {
    console.log('[BOOTSTRAP] Running with In-Memory transactional repositories (Zero-dependency mode)...');
    unitOfWork = new InMemoryUnitOfWork();
    walletRepo = new InMemoryWalletRepository();
    transactionRepo = new InMemoryWagerTransactionRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    outboxRepo = new InMemoryOutboxRepository();
    inboxRepo = new InMemoryInboxRepository();
    publisher = new MockMessagePublisher();
  }

  const app = createExpressApp({
    unitOfWork,
    walletRepo,
    transactionRepo,
    ledgerRepo,
    outboxRepo,
    inboxRepo,
  });

  // Start background workers
  const outboxWorker = new OutboxPublisherWorker(outboxRepo, publisher);
  outboxWorker.start();

  const refResolverWorker = new PendingReferenceResolverWorker(
    transactionRepo,
    outboxRepo,
    unitOfWork,
  );
  refResolverWorker.start();

  const server = app.listen(port, () => {
    console.log(`[HTTP SERVER] Distributed Wagering Processor running on http://localhost:${port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[SHUTDOWN] Terminating gracefully...');
    outboxWorker.stop();
    refResolverWorker.stop();
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('[FATAL] Bootstrap failed:', err);
  process.exit(1);
});
