import { Wallet } from '../../domain/wallet';
import { WagerTransaction } from '../../domain/wager-transaction';
import { WalletLedgerEntry } from '../../domain/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/outbox-message';
import { InboxMessage } from '../../domain/inbox-message';

export interface TransactionContext {
  connection: unknown;
}

export interface WalletRepositoryPort {
  findById(id: string, trx?: TransactionContext): Promise<Wallet | null>;
  findByIdForUpdate(id: string, trx: TransactionContext): Promise<Wallet | null>;
  findByPlayerAndCurrency(playerId: string, currency: string, trx?: TransactionContext): Promise<Wallet | null>;
  save(wallet: Wallet, trx: TransactionContext): Promise<void>;
}

export interface WagerTransactionRepositoryPort {
  findById(id: string, trx?: TransactionContext): Promise<WagerTransaction | null>;
  findByExternalId(providerId: string, externalId: string, trx?: TransactionContext): Promise<WagerTransaction | null>;
  findByIdempotencyKey(key: string, trx?: TransactionContext): Promise<WagerTransaction | null>;
  findPendingReferences(limit: number): Promise<WagerTransaction[]>;
  save(transaction: WagerTransaction, trx: TransactionContext): Promise<void>;
  update(transaction: WagerTransaction): Promise<void>;
}

export interface LedgerRepositoryPort {
  save(entry: WalletLedgerEntry, trx: TransactionContext): Promise<void>;
  findByWalletId(walletId: string, cursor?: string, limit?: number): Promise<{ items: WalletLedgerEntry[]; nextCursor?: string }>;
  sumEntriesForWallet(walletId: string): Promise<string>;
  countEntriesForWallet(walletId: string): Promise<number>;
}

export interface OutboxRepositoryPort {
  save(message: OutboxMessage, trx: TransactionContext): Promise<void>;
  findDueMessages(limit: number): Promise<OutboxMessage[]>;
  update(message: OutboxMessage): Promise<void>;
}

export interface InboxRepositoryPort {
  findByConsumerAndMessageId(consumer: string, messageId: string, trx?: TransactionContext): Promise<InboxMessage | null>;
  save(message: InboxMessage, trx: TransactionContext): Promise<void>;
}

export interface MessagePublisherPort {
  publish(queueUrl: string, message: unknown): Promise<void>;
}

export interface UnitOfWorkPort {
  runInTransaction<T>(work: (trx: TransactionContext) => Promise<T>): Promise<T>;
}

