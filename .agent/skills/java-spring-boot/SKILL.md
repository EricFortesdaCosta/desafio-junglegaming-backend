---
name: java-spring-boot
description: Enterprise Java 21+ and Spring Boot 3 development practices, Domain-Driven Design (DDD), Clean Architecture, Spring Data JPA with Pessimistic/Optimistic Locking, Testcontainers, and Resilience4j.
---

# Java & Spring Boot Enterprise Guide

This skill documents production-grade patterns for Java 21+ and Spring Boot 3 backends.

## 1. Domain-Driven Design in Java

- **Value Objects**: Use Java records or immutable classes with private constructors and static factory methods.
  ```java
  public record Money(BigDecimal amount, Currency currency) {
      public Money {
          Objects.requireNonNull(amount);
          Objects.requireNonNull(currency);
          if (amount.scale() > 2) throw new IllegalArgumentException("Scale must not exceed 2");
      }
      public Money add(Money other) {
          assertSameCurrency(other);
          return new Money(this.amount.add(other.amount), this.currency);
      }
  }
  ```

- **Concurrency & Locking with Spring Data JPA**:
  ```java
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT w FROM Wallet w WHERE w.id = :id")
  Optional<Wallet> findByIdForUpdate(@Param("id") UUID id);
  ```

- **Transactional Boundaries**:
  - `@Transactional(isolation = Isolation.READ_COMMITTED)`
  - Outbox pattern with `@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)` or direct persistence.

- **Automated Testing with Testcontainers**:
  - `PostgreSQLContainer` and `LocalStackContainer` for integration testing.
