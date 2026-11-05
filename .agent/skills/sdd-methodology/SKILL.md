---
name: sdd-methodology
description: Spec-Driven Development (SDD) & Software Design Document workflows. Guides API-first design (OpenAPI, AsyncAPI), formal contract-driven development, deterministic state machines, and system architecture specifications.
---

# Spec-Driven Development (SDD) Guide

Spec-Driven Development (SDD) is an engineering practice where the formal system specifications (OpenAPI for synchronous APIs, AsyncAPI for asynchronous messaging, and JSON Schemas / Domain Invariants) serve as the single source of truth before and during implementation.

## Core Tenets of SDD

1. **Contracts Before Code**:
   - Define exact request/response schemas, HTTP status codes, error payloads, and message headers in OpenAPI 3.1 or AsyncAPI 3.0 before writing controller code.
   - Every contract must include machine-readable validation rules (e.g. regex, decimal scale, string bounds).

2. **Domain Invariants Specification**:
   - Explicitly document preconditions, postconditions, and aggregate state transitions.
   - For financial and transactional systems: balance non-negativity, ledger balance reconciliation equations (`balanceBefore ± money == balanceAfter`), and terminal state immutability.

3. **Software Design Document (SDD / ARCHITECTURE.md)**:
   - Every system must be accompanied by an architectural specification that records:
     * Concurrency Model & Locking Strategy (e.g. Row-level `SELECT ... FOR UPDATE` vs Optimistic Locking with versions).
     * Idempotency Strategy (e.g. SHA-256 canonical hashing of business payloads, unique compound indexes).
     * Failure & Recovery Taxonomy (Transient vs Business vs Permanent failures, Backoff & DLQ).
     * Integration Architecture (Transactional Outbox Pattern, Deduplicated Inbox Pattern).

4. **Contract & Concurrency Testing**:
   - Automated tests validate that the implementation strictly conforms to the published specifications without schema drift.
   - Concurrency tests prove that distributed instances honor invariants under race conditions.
