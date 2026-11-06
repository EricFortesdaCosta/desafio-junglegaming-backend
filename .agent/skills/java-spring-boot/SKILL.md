---
name: java-spring-boot
description: Enterprise Java 21+ and Spring Boot 3+ development guide covering modern idioms (Virtual Threads, Records, Pattern Matching), Spring Data JPA performance, transaction management, resilience, and security.
---

# Java 21 & Spring Boot 3+ Enterprise Guide

Production-ready guidelines, idioms, and design patterns for building high-throughput, cloud-native enterprise services with modern Java and Spring Boot.

---

## 1. Modern Java 21 Idioms

### Use Records for Immutability & DTOs
Records automatically implement value equality, hashing, and immutability. Perfect for DTOs, API payloads, and query projections:

```java
public record CreateTransactionCommand(
    @NotNull UUID walletId,
    @Positive BigDecimal amount,
    @NotBlank String currency,
    @NotNull TransactionType type
) {}
```

### Pattern Matching & Sealed Interfaces for Domain State
Model business states exhaustively without fragile `instanceof` casts:

```java
public sealed interface TransactionState permits Pending, Confirmed, Failed {}

public record Pending(Instant createdAt) implements TransactionState {}
public record Confirmed(Instant settledAt, String externalReference) implements TransactionState {}
public record Failed(String reasonCode, Instant failedAt) implements TransactionState {}

public String describeState(TransactionState state) {
    return switch (state) {
        case Pending p   -> "Processing since " + p.createdAt();
        case Confirmed c -> "Settled at " + c.settledAt();
        case Failed f    -> "Failed: " + f.reasonCode();
    };
}
```

### Enable Virtual Threads (Project Loom)
In Spring Boot 3.2+, enable lightweight virtual threads in `application.yml`:

```yaml
spring:
  threads:
    virtual:
      enabled: true
```

---

## 2. Spring Data JPA & Performance Tuning

### Avoid the N+1 Query Problem
Use `@EntityGraph` or constructor DTO projections:

```java
public interface OrderRepository extends JpaRepository<Order, UUID> {
    @EntityGraph(attributePaths = {"items", "items.product"})
    Optional<Order> findWithItemsById(UUID id);
}
```

### Pessimistic Locking for Financial Records
For high-concurrency race conditions (e.g., deducting money from a shared wallet):

```java
public interface WalletRepository extends JpaRepository<Wallet, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT w FROM Wallet w WHERE w.id = :id")
    Optional<Wallet> findByIdForUpdate(@Param("id") UUID id);
}
```

---

## 3. The Transactional Outbox Pattern in Spring Boot

To achieve dual-write consistency without distributed transactions:
Mutate the business state (`Wallet`) and save an `OutboxEvent` in the **same DB transaction**.
A background worker or Debezium CDC reads from `outbox_events` and publishes to Kafka / SQS.
