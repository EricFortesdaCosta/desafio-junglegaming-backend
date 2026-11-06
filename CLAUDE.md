# Project Development Guidelines for Claude Code

This repository follows strict production engineering standards:

## 1. Specification-Driven Development (SDD)
- All new features and endpoints must begin with contract specifications (`openapi.yaml` or domain schemas).
- Business invariants (e.g., wallet balance, idempotency, transaction status transitions) must be defined upfront.
- Acceptance criteria must be formatted as executable BDD specifications (Given-When-Then).

## 2. Automated Testing Standards
- **Unit Tests**: Pure domain logic, fast, isolated, zero external I/O.
- **Integration Tests**: Real database/service testing with Testcontainers (PostgreSQL, LocalStack SQS/S3, Kafka).
- **Concurrency & Race Conditions**: Always stress-test simultaneous requests hitting the same aggregate root (`walletId`) to verify `SELECT FOR UPDATE` or optimistic locking and prevent double-spending.
- **Load Testing**: k6 validation ensuring p95 < 200ms with 0% error rate.

## 3. Clean Architecture & Domain-Driven Design (DDD)
- **Dependency Rule**: Inward dependencies only. The Domain layer must have zero framework/ORM dependencies.
- **Ports & Adapters (Hexagonal)**: Use Cases communicate through Inbound and Outbound Ports (interfaces). Infrastructure adapters implement the outbound ports.
- **Transactional Outbox Pattern**: Use outbox tables to achieve dual-write consistency with message brokers.

## 4. Modern Java & Spring Boot / TypeScript
- Immutability for commands and DTOs (`record` in Java, `readonly` interfaces in TypeScript).
- Proper locking mechanisms for financial state mutations (`PESSIMISTIC_WRITE`).
- Standard RFC 7807 Problem Details for all HTTP error responses.

