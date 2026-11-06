---
name: database-sql-tuning
description: PostgreSQL and relational database performance tuning, indexing strategies, migration management with Flyway/Liquibase, connection pooling, and transaction isolation.
---

# Database Performance, SQL Tuning & Migrations

A production guide for database design, index optimization, connection pool sizing, and zero-downtime schema migrations.

---

## 1. Indexing Strategies in PostgreSQL
- B-Tree indexes for Foreign Keys and Range Queries.
- Partial indexes for high-frequency status queries (`WHERE status = 'PENDING'`).
- Unique constraints supporting idempotency keys.

---

## 2. Reading EXPLAIN (ANALYZE, BUFFERS)
- Identify Seq Scans, nested loops without index, and disk spills.

---

## 3. Flyway Database Migrations
- Incremental, non-destructive migration scripts (`V1__...`, `V2__...`).
- Schema rollback and backward-compatible blue/green deployment strategy.

