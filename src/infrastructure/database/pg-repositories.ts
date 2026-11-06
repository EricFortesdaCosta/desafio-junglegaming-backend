import { Pool, PoolClient } from 'pg';
import { Money } from '../../domain/money';
import { Wallet } from '../../domain/wallet';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
  LedgerDirection,
} from '../../domain/wager-transaction';
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

export class PgUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly pool: Pool) {}

  public async runInTransaction<T>(work: (trx: TransactionContext) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({ connection: client });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PgWalletRepository implements WalletRepositoryPort {
  constructor(private readonly pool: Pool) {}

  private getClient(trx?: TransactionContext): Pool | PoolClient {
    return trx && trx.connection ? (trx.connection as PoolClient) : this.pool;
  }

  public async findById(id: string, trx?: TransactionContext): Promise<Wallet | null> {
    const client = this.getClient(trx);
    const res = await client.query('SELECT * FROM wallets WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async findByIdForUpdate(id: string, trx: TransactionContext): Promise<Wallet | null> {
    const client = trx.connection as PoolClient;
    const res = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [id]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async findByPlayerAndCurrency(playerId: string, currency: string, trx?: TransactionContext): Promise<Wallet | null> {
    const client = this.getClient(trx);
    const res = await client.query(
      'SELECT * FROM wallets WHERE player_id = $1 AND currency = $2',
      [playerId, currency],
    );
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async save(wallet: Wallet, trx: TransactionContext): Promise<void> {
    const client = trx.connection as PoolClient;
    await client.query(
      `INSERT INTO wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         balance_amount = EXCLUDED.balance_amount,
         version = EXCLUDED.version,
         updated_at = EXCLUDED.updated_at`,
      [
        wallet.id,
        wallet.playerId,
        wallet.currency,
        wallet.balance.toString(),
        wallet.version,
        wallet.createdAt,
        wallet.updatedAt,
      ],
    );
  }

  private mapRow(row: any): Wallet {
    return Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency,
      balance: Money.fromRaw(row.balance_amount, row.currency),
      version: row.version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}

export class PgWagerTransactionRepository implements WagerTransactionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  private getClient(trx?: TransactionContext): Pool | PoolClient {
    return trx && trx.connection ? (trx.connection as PoolClient) : this.pool;
  }

  public async findById(id: string, trx?: TransactionContext): Promise<WagerTransaction | null> {
    const client = this.getClient(trx);
    const res = await client.query('SELECT * FROM wager_transactions WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async findByExternalId(providerId: string, externalId: string, trx?: TransactionContext): Promise<WagerTransaction | null> {
    const client = this.getClient(trx);
    const res = await client.query(
      'SELECT * FROM wager_transactions WHERE provider_id = $1 AND external_transaction_id = $2',
      [providerId, externalId],
    );
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async findByIdempotencyKey(key: string, trx?: TransactionContext): Promise<WagerTransaction | null> {
    const client = this.getClient(trx);
    const res = await client.query('SELECT * FROM wager_transactions WHERE idempotency_key = $1', [key]);
    if (res.rows.length === 0) return null;
    return this.mapRow(res.rows[0]);
  }

  public async findPendingReferences(limit: number): Promise<WagerTransaction[]> {
    const res = await this.pool.query(
      "SELECT * FROM wager_transactions WHERE status = 'PENDING_REFERENCE' ORDER BY created_at ASC LIMIT $1",
      [limit],
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  public async save(tx: WagerTransaction, trx: TransactionContext): Promise<void> {
    const client = trx.connection as PoolClient;
    await client.query(
      `INSERT INTO wager_transactions (
        id, provider_id, external_transaction_id, idempotency_key, payload_hash,
        wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
        reference_external_transaction_id, reference_transaction_id, status, failure_code,
        created_at, processed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        failure_code = EXCLUDED.failure_code,
        reference_transaction_id = EXCLUDED.reference_transaction_id,
        processed_at = EXCLUDED.processed_at`,
      [
        tx.id,
        tx.providerId,
        tx.externalTransactionId,
        tx.idempotencyKey,
        tx.payloadHash,
        tx.walletId,
        tx.playerId,
        tx.roundId,
        tx.gameId,
        tx.kind,
        tx.money.toString(),
        tx.money.currency,
        tx.referenceExternalTransactionId ?? null,
        tx.referenceTransactionId ?? null,
        tx.status,
        tx.failureCode ?? null,
        tx.createdAt,
        tx.processedAt ?? null,
      ],
    );
  }

  public async update(tx: WagerTransaction): Promise<void> {
    await this.pool.query(
      `UPDATE wager_transactions SET
        status = $1,
        failure_code = $2,
        reference_transaction_id = $3,
        processed_at = $4
       WHERE id = $5`,
      [tx.status, tx.failureCode ?? null, tx.referenceTransactionId ?? null, tx.processedAt ?? null, tx.id],
    );
  }

  private mapRow(row: any): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind as WagerTransactionKind,
      money: Money.fromRaw(row.money_amount, row.money_currency),
      referenceExternalTransactionId: row.reference_external_transaction_id ?? undefined,
      status: row.status as WagerTransactionStatus,
      referenceTransactionId: row.reference_transaction_id ?? undefined,
      failureCode: row.failure_code ? (row.failure_code as FailureCode) : undefined,
      createdAt: new Date(row.created_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
    });
  }
}

export class PgLedgerRepository implements LedgerRepositoryPort {
  constructor(private readonly pool: Pool) {}

  public async save(entry: WalletLedgerEntry, trx: TransactionContext): Promise<void> {
    const client = trx.connection as PoolClient;
    await client.query(
      `INSERT INTO wallet_ledger_entries (
        id, wallet_id, transaction_id, direction, money_amount, money_currency,
        balance_before_amount, balance_after_amount, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.id,
        entry.walletId,
        entry.transactionId,
        entry.direction,
        entry.money.toString(),
        entry.money.currency,
        entry.balanceBefore.toString(),
        entry.balanceAfter.toString(),
        entry.createdAt,
      ],
    );
  }

  public async findByWalletId(
    walletId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<{ items: WalletLedgerEntry[]; nextCursor?: string }> {
    let query = `SELECT * FROM wallet_ledger_entries WHERE wallet_id = $1`;
    const params: any[] = [walletId];

    if (cursor) {
      const decodedDate = Buffer.from(cursor, 'base64').toString('ascii');
      params.push(new Date(decodedDate));
      query += ` AND created_at < $${params.length}`;
    }

    params.push(limit + 1);
    query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const res = await this.pool.query(query, params);
    const hasMore = res.rows.length > limit;
    const items = res.rows.slice(0, limit).map((r) => this.mapRow(r));
    const nextCursor =
      hasMore && items.length > 0
        ? Buffer.from(items[items.length - 1].createdAt.toISOString()).toString('base64')
        : undefined;

    return { items, nextCursor };
  }

  public async sumEntriesForWallet(walletId: string): Promise<string> {
    const res = await this.pool.query(
      `SELECT COALESCE(
        SUM(CASE WHEN direction = 'CREDIT' THEN money_amount ELSE -money_amount END),
        0.00
      ) as total FROM wallet_ledger_entries WHERE wallet_id = $1`,
      [walletId],
    );
    return Number(res.rows[0].total).toFixed(2);
  }

  public async countEntriesForWallet(walletId: string): Promise<number> {
    const res = await this.pool.query(
      'SELECT COUNT(*) as count FROM wallet_ledger_entries WHERE wallet_id = $1',
      [walletId],
    );
    return parseInt(res.rows[0].count, 10);
  }

  private mapRow(row: any): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: row.id,
      walletId: row.wallet_id,
      transactionId: row.transaction_id,
      direction: row.direction as LedgerDirection,
      money: Money.fromRaw(row.money_amount, row.money_currency),
      balanceBefore: Money.fromRaw(row.balance_before_amount, row.money_currency),
      balanceAfter: Money.fromRaw(row.balance_after_amount, row.money_currency),
      createdAt: new Date(row.created_at),
    });
  }
}

export class PgOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly pool: Pool) {}

  public async save(message: OutboxMessage, trx: TransactionContext): Promise<void> {
    const client = trx.connection as PoolClient;
    await client.query(
      `INSERT INTO outbox_messages (
        id, aggregate_id, event_type, payload, occurred_at, attempts, next_attempt_at, published_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        message.id,
        message.aggregateId,
        message.eventType,
        JSON.stringify(message.payload),
        message.occurredAt,
        message.attempts,
        message.nextAttemptAt ?? null,
        message.publishedAt ?? null,
      ],
    );
  }

  public async findDueMessages(limit: number): Promise<OutboxMessage[]> {
    const res = await this.pool.query(
      `SELECT * FROM outbox_messages
       WHERE published_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       ORDER BY occurred_at ASC
       LIMIT $1`,
      [limit],
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  public async update(message: OutboxMessage): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_messages SET
        attempts = $1,
        next_attempt_at = $2,
        published_at = $3
       WHERE id = $4`,
      [message.attempts, message.nextAttemptAt ?? null, message.publishedAt ?? null, message.id],
    );
  }

  private mapRow(row: any): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: row.id,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      occurredAt: new Date(row.occurred_at),
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : undefined,
      publishedAt: row.published_at ? new Date(row.published_at) : undefined,
    });
  }
}

export class PgInboxRepository implements InboxRepositoryPort {
  constructor(private readonly pool: Pool) {}

  public async findByConsumerAndMessageId(
    consumer: string,
    messageId: string,
    trx?: TransactionContext,
  ): Promise<InboxMessage | null> {
    const client = trx && trx.connection ? (trx.connection as PoolClient) : this.pool;
    const res = await client.query(
      'SELECT * FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2',
      [consumer, messageId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return InboxMessage.rehydrate({
      messageId: row.message_id,
      consumerName: row.consumer_name,
      payloadHash: row.payload_hash,
      receivedAt: new Date(row.received_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
    });
  }

  public async save(message: InboxMessage, trx: TransactionContext): Promise<void> {
    const client = trx.connection as PoolClient;
    await client.query(
      `INSERT INTO inbox_messages (message_id, consumer_name, payload_hash, received_at, processed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (consumer_name, message_id) DO UPDATE SET
         processed_at = EXCLUDED.processed_at`,
      [
        message.messageId,
        message.consumerName,
        message.payloadHash,
        message.receivedAt,
        message.processedAt ?? null,
      ],
    );
  }
}

