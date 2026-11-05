---
name: automated-testing
description: Comprehensive testing practices covering Unit Testing, Integration Testing with Real Containers (PostgreSQL, LocalStack SQS), Concurrency & Race Condition Verification, and Load Testing.
---

# Automated Testing Guide

This skill provides patterns and execution strategies for multi-tier automated test suites in high-concurrency distributed systems.

## 1. Test Pyramid & Distribution

- **Unit Tests**:
  * Pure domain models (Aggregates, Value Objects, Domain Services).
  * 100% deterministic, zero external I/O, sub-millisecond execution.
  * Test boundary cases: decimal rounding, arithmetic underflows, illegal state transitions, currency mismatches.

- **Integration Tests**:
  * Real PostgreSQL instance with real migrations, check constraints, foreign keys, and indexes.
  * Real SQS broker (LocalStack / MiniStack).
  * Transactional boundaries: verifying that outbox records and business mutations commit in the exact same DB transaction.

- **Concurrency & Race Condition Tests**:
  * Parallel execution (`Promise.all` or virtual threads) against the same aggregate root (`walletId`).
  * Verify that `SELECT FOR UPDATE` or optimistic locking blocks conflicting lost updates and prevents negative balance.
  * 50+ concurrent requests hitting the same idempotency key or balance pool.

- **Fault Tolerance & Recovery Tests**:
  * Outbox publisher recovery: Simulating worker crash right after database commit and before message publish.
  * Unordered message processing: Out-of-order `REFUND` before `BET` -> enters `PENDING_REFERENCE` and resolves when `BET` arrives.
