---
name: clean-architecture-ddd
description: Practical Clean Architecture and Domain-Driven Design (DDD) guide for building decoupled, maintainable, and testable enterprise applications with Hexagonal Ports & Adapters.
---

# Clean Architecture & Domain-Driven Design (DDD)

A pragmatic guide for organizing complex business systems into maintainable, loosely coupled architectural layers.

---

## 1. Architectural Layers & Dependency Rule

The golden rule of Clean Architecture: **Dependencies only point inward.**
The core domain has ZERO knowledge of frameworks, databases, or external APIs.

```
+-------------------------------------------------------+
|  INFRASTRUCTURE (PostgreSQL, Kafka, REST, Docker)     |
|   +-----------------------------------------------+   |
|   |  APPLICATION (Use Cases, Commands, Queries)   |   |
|   |   +---------------------------------------+   |   |
|   |   |  DOMAIN (Aggregates, Value Objects)   |   |   |
|   |   +---------------------------------------+   |   |
|   +-----------------------------------------------+   |
+-------------------------------------------------------+
```

---

## 2. Tactical DDD Components

### Value Object Pattern
Immutable, defined solely by its attributes. No identity:

```typescript
export class Money {
  constructor(public readonly amount: number, public readonly currency: string) {
    if (amount < 0) throw new Error("Amount cannot be negative");
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) throw new Error("Currency mismatch");
    return new Money(this.amount + other.amount, this.currency);
  }
}
```

---

## 3. Ports & Adapters (Hexagonal Architecture)
- **Inbound Port**: Interface exposing Use Case (`ProcessWagerUseCase`).
- **Outbound Port**: Interface defining external contracts (`WalletRepository`, `EventPublisher`).
- **Infrastructure Adapter**: Implementation details (`PostgresWalletRepository`, `SqsEventPublisher`).

