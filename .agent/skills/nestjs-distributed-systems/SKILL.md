---
name: nestjs-distributed-systems
description: Distributed systems architecture using NestJS, Bun runtime, PostgreSQL row-level locking, AWS SQS messaging, Transactional Outbox pattern, and persistent idempotency.
---

# NestJS Distributed Systems Guide

This skill documents production-ready architecture for distributed, high-concurrency wagering and financial systems using NestJS, Bun, and PostgreSQL.

## Core Architectural Pillars

1. **Strict Money Handling**:
   - Never use JS `number` for monetary values. Use `decimal.js` or arbitrary-precision strings with scale 2.
   - Encapsulate in an immutable `Money` Value Object.

2. **Concurrency Control**:
   - The unit of concurrency is the `walletId`.
   - Prevent race conditions using PostgreSQL row-level locking: `SELECT ... FOR UPDATE`.
   - Never allow negative balance or lost updates across multiple application instances.

3. **Transactional Outbox & Inbox Patterns**:
   - Database mutations (wallet balance, ledger entry, outbox message, and inbox record) MUST commit in the exact same SQL transaction.
   - Outbox publisher worker reads pending messages (`published_at IS NULL`) with row locks or atomic updates and publishes them to AWS SQS.

4. **Persistent Idempotency**:
   - Cache-in-memory is strictly forbidden for idempotency.
   - Compound unique index in PostgreSQL on `(provider_id, external_transaction_id)` or `idempotency_key`.
   - SHA-256 canonical payload hashing to distinguish true replay (return cached result) from conflicting payload changes (return 409 Conflict).

