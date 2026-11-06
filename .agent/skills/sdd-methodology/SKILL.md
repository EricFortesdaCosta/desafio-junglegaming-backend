---
name: sdd-methodology
description: Specification-Driven Development (SDD) guide for designing, specifying, and validating software architectures, API contracts, domain models, and acceptance criteria before writing code.
---

# Specification-Driven Development (SDD) Guide

Specification-Driven Development (SDD) is an engineering practice where the system's external behavior, data models, contracts, and business invariants are formally specified and validated before any implementation code is written.

## 1. Core Principles of SDD
1. **Contract-First over Code-First**: APIs (REST, gRPC, Event-driven) must have authoritative contracts (`openapi.yaml`, `asyncapi.yaml`, `.proto`) established before endpoint coding begins.
2. **Deterministic Acceptance Criteria**: Every feature has clear, verifiable criteria written in Given-When-Then format (Executable Specs / BDD).
3. **Explicit Domain Invariants**: Rules like financial balance constraints, state machines, and idempotency guarantees are documented in formal schemas before writing business logic.
4. **Zero-Rework Goal**: By clarifying boundaries, types, and edge cases upfront, implementation becomes a straightforward execution of the specification.

---

## 2. SDD Workflow Pipeline

```
[ Requirements Discovery ]
            ↓
[ 1. Domain Modeling & Invariants Matrix ]
            ↓
[ 2. Contract-First API & Event Schema Definition ]
            ↓
[ 3. Executable Test Scenarios (Gherkin / Test Cases) ]
            ↓
[ 4. Automated Contract & Schema Validation ]
            ↓
[ 5. Implementation (TDD / Clean Architecture) ]
            ↓
[ 6. Verification Against Specification ]
```

---

## 3. Phase 1: Invariants & Boundary Matrix

Before coding any entity or use case, map all rules in an Invariants Matrix:

| Entity / Field | Rule / Invariant | Validation Boundary | Error Code / Behavior |
| :--- | :--- | :--- | :--- |
| `amount` | Must be strictly positive | `amount > 0` and max 2 decimal places | `INVALID_AMOUNT (400)` |
| `wallet.balance` | Never negative unless overdraft permitted | `balance - debitAmount >= 0` | `INSUFFICIENT_FUNDS (422)` |
| `transactionId` | Idempotent uniqueness | Unique index in database | `DUPLICATE_TRANSACTION (409)` |
| `status` | State machine transitions | `PENDING` -> `CONFIRMED` or `FAILED` | `ILLEGAL_STATE_TRANSITION (400)` |

---

## 4. Phase 2: Contract-First Specifications

### REST APIs: OpenAPI 3.1
Always define standard response envelopes, problem details (RFC 7807), and explicit validation constraints:

```yaml
openapi: 3.1.0
info:
  title: Transaction Processing Service
  version: 1.0.0
paths:
  /api/v1/transactions:
    post:
      summary: Process financial transaction
      operationId: processTransaction
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TransactionRequest'
      responses:
        '201':
          description: Transaction created successfully
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TransactionResponse'
        '400':
          $ref: '#/components/responses/BadRequestError'
        '422':
          $ref: '#/components/responses/UnprocessableEntityError'
components:
  schemas:
    TransactionRequest:
      type: object
      required: [transactionId, walletId, amount, currency, type]
      properties:
        transactionId:
          type: string
          format: uuid
        walletId:
          type: string
          format: uuid
        amount:
          type: number
          format: double
          minimum: 0.01
        currency:
          type: string
          enum: [BRL, USD, EUR]
```

---

## 5. Phase 3: Executable Acceptance Specifications (BDD)

Translate business specifications into executable scenarios:

```gherkin
Feature: Wager and Settlement Processing

  Scenario: Successful wager deduction with sufficient balance
    Given a wallet "w-100" exists with balance 50.00 BRL
    When a wager transaction of 20.00 BRL is submitted with key "tx-001"
    Then the transaction should succeed with status "CONFIRMED"
    And the updated wallet balance should be 30.00 BRL
    And an outbox message "WagerProcessed" should be queued

  Scenario: Reject wager when balance is insufficient
    Given a wallet "w-100" exists with balance 10.00 BRL
    When a wager transaction of 25.00 BRL is submitted with key "tx-002"
    Then the transaction should fail with error "INSUFFICIENT_FUNDS"
    And the wallet balance must remain 10.00 BRL
    And no ledger mutation should be committed
```

---

## 6. SDD Verification Checklist
- [ ] Contract file (`openapi.yaml` or `schema.json`) is the single source of truth.
- [ ] DTOs and interfaces are generated or validated against the contract.
- [ ] Positive, boundary, and negative scenarios have corresponding automated tests.
- [ ] Concurrency, idempotency, and rollback behaviors are explicitly defined.
- [ ] Error payloads conform to standard RFC 7807 (Problem Details).
