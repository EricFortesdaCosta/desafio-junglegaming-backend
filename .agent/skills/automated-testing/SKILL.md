---
name: automated-testing
description: Comprehensive testing practices covering Unit Testing, Integration Testing with Real Containers (PostgreSQL, LocalStack SQS), Concurrency & Race Condition Verification, and Load Testing (k6).
---

# Enterprise Automated Testing Guide

This skill provides patterns, architecture, and code templates for building robust, multi-tier automated test suites in mission-critical applications.

---

## 1. The Modern Test Pyramid

```
       /\
      /  \      E2E / Smoke Tests (5-10%): High latency, critical path only
     /----\
    /      \    Integration Tests with Testcontainers (20-30%): Real DB, Queues, Caches
   /--------\
  /          \  Unit Tests (60-70%): Pure domain logic, fast (<1s total suite), deterministic
 /------------\
```

---

## 2. Unit Testing Best Practices
- **Strict AAA Pattern**: Arrange, Act, Assert.
- **Fast & Isolated**: Zero network, zero database I/O, zero filesystem calls.
- **Boundary & Property Testing**:
  * Edge values: `0`, `-1`, `MAX_INT`, empty strings, nulls, high-precision decimals (`BigDecimal`).
  * Invariant validation: Ensure aggregate root cannot enter illegal states.

---

## 3. Integration Testing with Real Containers (Testcontainers)

Never use in-memory databases (like H2) to test production databases (like PostgreSQL). H2 lacks specific locking mechanisms, JSON operators, and dialect-specific constraints.
Use real containers for PostgreSQL, LocalStack (SQS/SNS), and Redis.

---

## 4. Concurrency & Race Condition Testing

When testing transactions, balance mutations, or idempotency, always verify behavior under concurrent thread pressure.
- Run parallel threads hitting the same walletId.
- Verify that `SELECT FOR UPDATE` or optimistic locking blocks conflicting lost updates and prevents negative balance.
- 50+ concurrent requests hitting the same idempotency key or balance pool.

---

## 5. Fault Tolerance & Recovery Tests
- Outbox publisher recovery: Simulating worker crash right after database commit and before message publish.
- Unordered message processing: Out-of-order `REFUND` before `BET` -> enters `PENDING_REFERENCE` and resolves when `BET` arrives.
- Load testing with k6: Validate p95 latency under 200ms with zero 500 errors.
