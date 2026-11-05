-- 001_initial_schema.sql
-- Technical Challenge — Distributed Wagering Processor

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Wallets
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY,
    player_id VARCHAR(100) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    balance_amount NUMERIC(15, 2) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_wallet_balance_non_negative CHECK (balance_amount >= 0),
    CONSTRAINT uq_player_currency UNIQUE (player_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_wallets_player ON wallets(player_id);

-- 2. Wager Transactions
CREATE TABLE IF NOT EXISTS wager_transactions (
    id UUID PRIMARY KEY,
    provider_id VARCHAR(100) NOT NULL,
    external_transaction_id VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    player_id VARCHAR(100) NOT NULL,
    round_id VARCHAR(100) NOT NULL,
    game_id VARCHAR(100) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    money_amount NUMERIC(15, 2) NOT NULL,
    money_currency VARCHAR(3) NOT NULL,
    reference_external_transaction_id VARCHAR(255),
    reference_transaction_id UUID REFERENCES wager_transactions(id),
    status VARCHAR(30) NOT NULL,
    failure_code VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT uq_provider_external_id UNIQUE (provider_id, external_transaction_id),
    CONSTRAINT uq_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_wager_tx_wallet ON wager_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wager_tx_pending_ref ON wager_transactions(status) WHERE status = 'PENDING_REFERENCE';

-- 3. Wallet Ledger Entries (Immutable Append-Only)
CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
    id UUID PRIMARY KEY,
    wallet_id UUID NOT NULL REFERENCES wallets(id),
    transaction_id UUID NOT NULL REFERENCES wager_transactions(id),
    direction VARCHAR(10) NOT NULL,
    money_amount NUMERIC(15, 2) NOT NULL,
    money_currency VARCHAR(3) NOT NULL,
    balance_before_amount NUMERIC(15, 2) NOT NULL,
    balance_after_amount NUMERIC(15, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ledger_direction CHECK (direction IN ('DEBIT', 'CREDIT')),
    CONSTRAINT chk_ledger_money_positive CHECK (money_amount > 0),
    CONSTRAINT chk_ledger_before_non_negative CHECK (balance_before_amount >= 0),
    CONSTRAINT chk_ledger_after_non_negative CHECK (balance_after_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_ledger_wallet_created ON wallet_ledger_entries(wallet_id, created_at DESC);

-- Trigger to enforce ledger immutability
CREATE OR REPLACE FUNCTION prevent_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Wallet ledger entries are immutable and cannot be updated or deleted!';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ledger_mod ON wallet_ledger_entries;
CREATE TRIGGER trg_prevent_ledger_mod
BEFORE UPDATE OR DELETE ON wallet_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();

-- 4. Inbox Messages (Deduplication)
CREATE TABLE IF NOT EXISTS inbox_messages (
    message_id VARCHAR(255) NOT NULL,
    consumer_name VARCHAR(100) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    PRIMARY KEY (consumer_name, message_id)
);

-- 5. Outbox Messages (Transactional Outbox)
CREATE TABLE IF NOT EXISTS outbox_messages (
    id UUID PRIMARY KEY,
    aggregate_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_messages(published_at, next_attempt_at)
WHERE published_at IS NULL;
