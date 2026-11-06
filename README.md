# Distributed Wagering Processor 🎰⚡

[![CI](https://github.com/EricFortesdaCosta/desafio-junglegaming-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/EricFortesdaCosta/desafio-junglegaming-backend/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%25-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.x-black.svg)](https://bun.sh/)
[![NestJS](https://img.shields.io/badge/NestJS-10.x-red.svg)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue.svg)](https://www.postgresql.org/)

Serviço financeiro distribuído de alta concorrência projetado para processamento robusto de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) em plataformas de iGaming, garantindo consistência estrita, idoneidade contábil e entrega *at-least-once*.

---

## 🛠️ Stack Tecnológica

- **Runtime & Gerenciador de Pacotes:** [Bun 1.x](https://bun.sh/)
- **Linguagem:** TypeScript (Modo Estrito)
- **Framework:** NestJS / Express
- **Persistência:** PostgreSQL 16 (com Triggers, Checks e Pessimistic Locking `SELECT ... FOR UPDATE`)
- **Mensageria:** AWS SQS (compatível com LocalStack)
- **Containerização:** Docker & Docker Compose

---

## 🏛️ Decisões Arquiteturais & Padrões (Clean Architecture & DDD)

1. **Precisão Monetária Absoluta:** O Value Object `Money` utiliza `decimal.js` com escala fixa de 2 casas decimais e validação estrita. Tipos primitivos (`number`, `float`) são banidos de cálculos financeiros.
2. **Concorrência & Prevenção de Double-Spending:** O saldo da carteira (`Wallet`) é protegido por bloqueio pessimista (`SELECT ... FOR UPDATE`) na tabela relacional. O sistema garante que apostas concorrentes disputando o mesmo saldo nunca gerem saldo negativo ou race conditions.
3. **Idempotência Durável & Hashing Canônico:** Deduplicação persistente no banco indexando `(provider_id, external_transaction_id)` com validação via hash SHA-256 dos campos de negócio. Reenvios idênticos retornam o resultado original (`idempotentReplay: true`); payloads divergentes geram conflito.
4. **Transactional Outbox & Inbox Patterns:** Consistência dual atômica entre transação financeira, ledger imutável e mensageria SQS. Workers em segundo plano gerenciam reentregas, backoff exponencial e mensagens fora de ordem (`PENDING_REFERENCE`).

---

## 📦 Como Executar o Projeto

### Pré-requisitos

- [Bun](https://bun.sh/) instalado
- [Docker & Docker Compose](https://www.docker.com/)

### 1. Instalar dependências

```bash
bun install
```

### 2. Subir infraestrutura (PostgreSQL & LocalStack)

```bash
docker compose up --build -d
```

### 3. Executar os testes automatizados

O projeto conta com uma suíte abrangente de testes unitários, de concorrência e de integração:

```bash
bun test
```

### 4. Iniciar a aplicação localmente

```bash
bun run start
```

---

## 📁 Estrutura do Repositório

```text
├── docs/                 # Especificações OpenAPI 3.1 e AsyncAPI 3.0
├── src/
│   ├── domain/           # Domínio puro (Entities, Value Objects, Regras de negócio)
│   ├── application/      # Casos de uso e portas hexagonais
│   ├── infrastructure/   # Repositórios Postgres, clientes SQS e Workers Outbox/Inbox
│   └── interfaces/       # Controllers HTTP REST e logs estruturados
├── test/
│   ├── unit/             # Testes unitários puros
│   ├── concurrency/      # Testes de stress de concorrência paralela (50+ requests)
│   └── integration/      # Testes de integração com banco e mensageria
└── docker-compose.yml    # Orquestração local completa
```

---

## 👨‍💻 Autor

Desenvolvido por **Eric Fortes da Costa** para o processo seletivo da **Jungle Gaming**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
