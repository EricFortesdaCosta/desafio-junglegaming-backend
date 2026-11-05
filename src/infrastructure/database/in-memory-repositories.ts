import { Money } from '../../domain/money';
import { Wallet } from '../../domain/wallet';
import { WagerTransaction } from '../../domain/wager-transaction';
import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/outbox-message';
import { InboxMessage } from '../../domain/inbox-message';
import {
  WalletRepositoryPort,
  WagerTransactionRepositoryPort,
  LedgerRepositoryPort,
  OutboxRepositoryPort,
  InboxRepositoryPort,
  UnitOfWorkPort,
  TransactionContext,
} from '../../application/ports/ports';

class Mutex {
  private mutex = Promise.resolve();

  public lock(): Promise<() => void> {
    let unlock: () => void;
    const next = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const willLock = this.mutex.then(() => unlock);
    this.mutex = this.mutex.then(() => next);
    return willLock;
  }
}

export class InMemoryUnitOfWork implements UnitOfWorkPort {
  private globalLock = new Mutex();

  public async runInTransaction<T>(work: (trx: TransactionContext) => Promise<T>): Promise<T> {
    // In-memory atomic block
    const unlock = await this.globalLock.lock();
    try {
      return await work({ connection: null });
    } finally {
      unlock();
    }
  }
}

export class InMemoryWalletRepository implements WalletRepositoryPort {
  private wallets = new Map<string, Wallet>();
  private walletLocks = new Map<string, Mutex>();

  public async findById(id: string): Promise<Wallet | null> {
    const w = this.wallets.get(id);
    if (!w) return null;
    return Wallet.rehydrate({
      id: w.id,
      playerId: w.playerId,
      currency: w.currency,
      balance: w.balance,
      version: w.version,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    });
  }

  public async findByIdForUpdate(id: string, trx: TransactionContext): Promise<Wallet | null> {
    return this.findById(id);
  }

  public async findByPlayerAndCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    for (const w of this.wallets.values()) {
      if (w.playerId === playerId && w.currency === currency) {
        return this.findById(w.id);
      }
    }
    return null;
  }

  public async save(wallet: Wallet): Promise<void> {
    this.wallets.set(
      wallet.id,
      Wallet.rehydrate({
        id: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        balance: wallet.balance,
        version: wallet.version,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      }),
    );
  }

  public clear(): void {
    this.wallets.clear();
  }
}

export class InMemoryWagerTransactionRepository implements WagerTransactionRepositoryPort {
  private transactions = new Map<string, WagerTransaction>();

  public async findById(id: string): Promise<WagerTransaction | null> {
    const tx = this.transactions.get(id);
    if (!tx) return null;
    return this.clone(tx);
  }

  public async findByExternalId(providerId: string, externalId: string): Promise<WagerTransaction | null> {
    for (const tx of this.transactions.values()) {
      if (tx.providerId === providerId && tx.externalTransactionId === externalId) {
        return this.clone(tx);
      }
    }
    return null;
  }

  public async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    for (const tx of this.transactions.values()) {
      if (tx.idempotencyKey === key) {
        return this.clone(tx);
      }
    }
    return null;
  }

  public async findPendingReferences(limit: number): Promise<WagerTransaction[]> {
    const list: WagerTransaction[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.status === 'PENDING_REFERENCE') {
        list.push(this.clone(tx));
        if (list.length >= limit) break;
      }
    }
    return list;
  }

  public async save(transaction: WagerTransaction): Promise<void> {
    this.transactions.set(transaction.id, this.clone(transaction));
  }

  public async update(transaction: WagerTransaction): Promise<void> {
    this.transactions.set(transaction.id, this.clone(transaction));
  }

  public clear(): void {
    this.transactions.clear();
  }

  private clone(tx: WagerTransaction): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      idempotencyKey: tx.idempotencyKey,
      payloadHash: tx.payloadHash,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money,
      referenceExternalTransactionId: tx.referenceExternalTransactionId,
      createdAt: tx.createdAt,
      status: tx.status,
      referenceTransactionId: tx.referenceTransactionId,
      failureCode: tx.failureCode,
      processedAt: tx.processedAt,
    });
  }
}

export class InMemoryLedgerRepository implements LedgerRepositoryPort {
  private entries: WalletLedgerEntry[] = [];

  public async save(entry: WalletLedgerEntry): Promise<void> {
    this.entries.push(
      WalletLedgerEntry.rehydrate({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money,
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        createdAt: entry.createdAt,
      }),
    );
  }

  public async findByWalletId(
    walletId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<{ items: WalletLedgerEntry[]; nextCursor?: string }> {
    let filtered = this.entries.filter((e) => e.walletId === walletId);
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (cursor) {
      const decoded = new Date(Buffer.from(cursor, 'base64').toString('ascii'));
      filtered = filtered.filter((e) => e.createdAt.getTime() < decoded.getTime());
    }

    const items = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextCursor =
      hasMore && items.length > 0
        ? Buffer.from(items[items.length - 1].createdAt.toISOString()).toString('base64')
        : undefined;

    return { items, nextCursor };
  }

  public async sumEntriesForWallet(walletId: string): Promise<string> {
    let sum = 0;
    for (const e of this.entries) {
      if (e.walletId === walletId) {
        const val = parseFloat(e.money.toString());
        if (e.direction === 'CREDIT') {
          sum += val;
        } else {
          sum -= val;
        }
      }
    }
    return sum.toFixed(2);
  }

  public async countEntriesForWallet(walletId: string): Promise<number> {
    return this.entries.filter((e) => e.walletId === walletId).length;
  }

  public clear(): void {
    this.entries = [];
  }
}

export class InMemoryOutboxRepository implements OutboxRepositoryPort {
  private messages: OutboxMessage[] = [];

  public async save(message: OutboxMessage): Promise<void> {
    this.messages.push(message);
  }

  public async findDueMessages(limit: number): Promise<OutboxMessage[]> {
    const now = new Date();
    return this.messages.filter((m) => m.isDue(now)).slice(0, limit);
  }

  public async update(message: OutboxMessage): Promise<void> {
    const index = this.messages.findIndex((m) => m.id === message.id);
    if (index >= 0) {
      this.messages[index] = message;
    }
  }

  public getAllMessages(): OutboxMessage[] {
    return this.messages;
  }

  public clear(): void {
    this.messages = [];
  }
}

export class InMemoryInboxRepository implements InboxRepositoryPort {
  private messages = new Map<string, InboxMessage>();

  public async findByConsumerAndMessageId(consumer: string, messageId: string): Promise<InboxMessage | null> {
    const key = `${consumer}:${messageId}`;
    return this.messages.get(key) ?? null;
  }

  public async save(message: InboxMessage): Promise<void> {
    const key = `${message.consumerName}:${message.messageId}`;
    this.messages.set(key, message);
  }

  public clear(): void {
    this.messages.clear();
  }
}
