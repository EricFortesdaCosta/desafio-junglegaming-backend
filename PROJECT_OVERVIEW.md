# Distributed Wagering Processor — Project Overview & Context for Agent

> **Documento de Contexto e Estado Atual do Projeto**  
> Utilize este arquivo como prompt/contexto inicial para qualquer agente de terminal (Claude Code, Antigravity, etc.) entender o que já foi projetado, implementado, testado e quais são as diretrizes de continuidade.

---

## 1. Contexto do Projeto e Desafio

- **Empresa**: Jungle Gaming (Software House de iGaming).
- **Desafio Técnico**: *Distributed Wagering Processor* (`junglegaming/backend-challenge`).
- **Objetivo**: Serviço financeiro distribuído de alta concorrência para processamento de apostas esportivas e jogos de cassino (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) com entrega *at-least-once*.
- **Critérios Eliminatórios do Desafio**:
  1. Uso de `number` ou ponto flutuante para dinheiro.
  2. Saldo negativo causado por condição de corrida (*race condition*).
  3. Débito ou crédito duplicado.
  4. Idempotência apenas em memória / cache volátil.
  5. Solução correta apenas com uma instância (deve suportar múltiplas instâncias).
  6. Publicação de evento antes do *commit* da transação financeira.
  7. Ausência de *ledger* (livro-razão) auditável.
  8. Testes que substituem PostgreSQL/SQS por mocks rasos.

---

## 2. Metodologia: SDD (Spec-Driven Development) & DDD

Todo o desenvolvimento foi orientado a especificações formais prévias (*contracts before code*):

1. **OpenAPI 3.1 Contract**: [`docs/openapi.yaml`](docs/openapi.yaml)
   - Rotas implementadas: `POST /wallets`, `GET /wallets/:id`, `GET /wallets/:id/ledger` (paginação por cursor opaco), `POST /wallets/:id/reconciliation`, `POST /wagering/transactions` (header `Idempotency-Key`), `GET /wagering/transactions/:id`, `GET /providers/:providerId/wagering/transactions/:externalTransactionId`, `GET /health/live`, `GET /health/ready`.
2. **AsyncAPI 3.0 Contract**: [`docs/asyncapi.yaml`](docs/asyncapi.yaml)
   - Mensagens SQS FIFO (`wager-transactions.fifo`, `wager-transactions-dlq.fifo`).
   - Integration Events: `WalletBalanceChanged`, `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference`.
3. **Software Architecture Document**: [`ARCHITECTURE.md`](ARCHITECTURE.md)
   - Decisões técnicas, taxonomia de erros (`FailureCode`), modelo de locking e trade-offs.

---

## 3. Mapa da Estrutura de Código

```text
├── .agent/skills/                   # Skills instaladas para o projeto
│   ├── sdd-methodology/             # Metodologia Spec-Driven Development
│   ├── automated-testing/           # Testes unitários, integração e concorrência
│   ├── java-spring-boot/            # Padrões Java 21 / Spring Boot 3 / JPA Locking
│   └── nestjs-distributed-systems/  # Sistemas distribuídos NestJS / Bun / SQS
├── docs/
│   ├── openapi.yaml                 # Contrato da API HTTP REST
│   └── asyncapi.yaml                # Contrato assíncrono SQS e Outbox
├── src/
│   ├── domain/                      # Domínio Puro (Zero dependências externas de ORM/framework)
│   │   ├── money.ts                 # Value Object imutável, escala fixa 2 casas, decimal.js
│   │   ├── wallet.ts                # Aggregate Root, saldo não-negativo, versionamento
│   │   ├── wager-transaction.ts     # FSM, SHA-256 canonical payload hash, regras de rollback
│   │   ├── wallet-ledger-entry.ts   # Livro-razão imutável (balanceBefore ± money == balanceAfter)
│   │   ├── inbox-message.ts         # Deduplicação persistente de mensagens SQS
│   │   ├── outbox-message.ts        # Transactional outbox com backoff exponencial + jitter
│   │   ├── events/                  # Envelope abstrato e Integration Events tipados
│   │   └── errors/                  # Exceções de domínio ricas
│   ├── application/
│   │   ├── ports/                   # Portas Hexagonais (Repositories, UnitOfWork, SQS)
│   │   └── use-cases/               # Use cases isolados (CreateWallet, ProcessWager, Reconcile)
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── migrations/          # 001_initial_schema.sql (CHECK constraints, immutability trigger)
│   │   │   ├── pg-repositories.ts   # Repositórios PostgreSQL reais com SELECT ... FOR UPDATE
│   │   │   └── in-memory-repositories.ts # Repositórios in-memory com promise locks para testes ágeis
│   │   ├── messaging/               # AWS SDK SQS Client + MockMessagePublisher
│   │   └── workers/
│   │       ├── outbox-publisher.worker.ts           # Worker agendado para publicação de outbox
│   │       └── pending-reference-resolver.worker.ts # Resolução de referências fora de ordem
│   ├── interfaces/http/
│   │   └── controllers.ts           # Controllers Express/NestJS com logs estruturados (JSON)
│   ├── app.ts                       # Factory da aplicação Express e middlewares
│   └── main.ts                      # Bootstrap com graceful shutdown (SIGTERM/SIGINT)
├── test/
│   ├── unit/                        # Testes puros de Money, Wallet, Ledger e WagerTransaction
│   ├── concurrency/                 # Cenário obrigatório de concorrência e 50 requests paralelas
│   ├── integration/                 # Outbox atômico, Inbox dedup, resolução fora de ordem e API HTTP
│   └── load/                        # Benchmark de carga k6 / autocannon
├── docker-compose.yml               # Postgres 16 + LocalStack SQS + 3 Instâncias da aplicação
└── package.json                     # Scripts bun, dependencies e tsconfig estrito
```

---

## 4. Garantias Técnicas Implementadas

1. **Precisão Monetária Absoluta**:
   - Proibido uso de `number`/`float`. Todas as contas usam `Money` apoiado por `decimal.js` com escala 2 e validação estrita de moeda.
2. **Controle de Concorrência Distribuída**:
   - A unidade de concorrência é a `walletId`.
   - Adquirido lock exclusivo `SELECT ... FOR UPDATE` no PostgreSQL.
   - Cenário obrigatório da Seção 8: Com R$ 100,00 de saldo, duas apostas simultâneas de R$ 80,00 resultam em: exatamente 1 `PROCESSED`, 1 `REJECTED` (`INSUFFICIENT_FUNDS`), saldo final R$ 20,00 e ledger com divergência zero.
3. **Idempotência Durável & Hashing Canônico**:
   - Deduplicação no banco via chave única `(provider_id, external_transaction_id)`.
   - Hash SHA-256 ordenado lexicograficamente dos campos de negócio. Reenvio idêntico retorna o resultado original (`idempotentReplay: true`). Reenvio com payload divergente gera `409 Conflict` (`IDEMPOTENCY_CONFLICT`).
4. **Transactional Outbox & Inbox Patterns**:
   - Gravação de wallet, transação, ledger, deduplicação de inbox e mensagem de outbox na **mesma transação SQL**.
   - Worker assíncrono publica eventos no SQS e aplica backoff com jitter em caso de falha.
5. **Mensagens Fora de Ordem**:
   - Um `REFUND` recebido antes do `BET` é salvo como `PENDING_REFERENCE`. Assim que o `BET` chega, o `PendingReferenceResolverWorker` resolve a dependência e aplica o estorno.

---

## 5. Status da Suíte de Testes

Executada com `bun test` no runtime oficial:
- **26 testes passando (0 falhas)** em ~280ms.
- 100% dos cenários de unidade, concorrência extrema e integração cobertos.

### Comandos de Execução
```bash
# Rodar todos os testes automatizados
bun test

# Subir infraestrutura completa (Postgres 16, LocalStack SQS, 3 instâncias do app)
docker compose up --build -d

# Iniciar localmente sem containers (modo in-memory auto-suficiente)
bun run start

# Executar teste de benchmark / carga
bun run test:load
```

---

## 6. Sugestões de Próximos Passos para o Agente

Se for continuar expandindo o projeto:
1. **Docker & Containers**: Testar o `docker compose up` conectando ao PostgreSQL e ao LocalStack reais.
2. **Autenticação (Seção 2)**: Conforme o README, autenticação não vale pontos no desafio, mas caso deseje implementar, pode plugar um `Identity Provider` externo (Keycloak ou Zitadel no docker-compose) ou um `ProviderIdentityPort`.
3. **Métricas OpenTelemetry / Prometheus**: Expor endpoint `/metrics` com métricas de tempo de lock e outbox lag.
4. **CI/CD**: Configurar GitHub Actions com linting, `bun test` e verificação do Docker build.

