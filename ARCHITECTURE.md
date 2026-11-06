# Distributed Wagering Processor — Software Architecture Document

## 1. Visão Geral e Decisões de Arquitetura

O **Distributed Wagering Processor** é uma plataforma financeira de alta concorrência desenhada para processamento at-least-once de transações de apostas esportivas e jogos de cassino (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`), com estrita garantia de correção financeira, idempotência persistente e integridade auditável.

A arquitetura foi concebida segundo os princípios de **Domain-Driven Design (DDD)**, **Clean Architecture** e **Spec-Driven Development (SDD)**, eliminando acoplamentos do modelo de negócio com frameworks e bibliotecas externas.

---

## 2. Princípios e Invariantes do Domínio

### 2.1 Modelo de Dinheiro (`Money`)
- **Precisão Arbitrária e Escala Fixa**: O domínio nunca utiliza `number`, `float` ou ponto flutuante do JavaScript. Todas as operações aritméticas são encapsuladas no Value Object `Money`, apoiado por representação decimal exata com **2 casas decimais** e validação rigorosa de moeda (ISO-4217, e.g. `BRL`).
- **Imutabilidade**: Todas as mutações (`add`, `subtract`, `negate`) geram uma nova instância.
- **Validação de Entrada**: Bloqueio em runtime de notação científica, valores negativos em contratos de entrada, `NaN`, `Infinity` e divergências de moeda.

### 2.2 Wallet (Aggregate Root)
- **Identidade Única**: Restrição `UNIQUE(player_id, currency)` imposta a nível de banco de dados.
- **Invariante de Saldo**: O saldo nunca pode ser negativo (`balance >= 0.00`). A constraint é reforçada por `CHECK (balance_amount >= 0)` no PostgreSQL.
- **Integridade Biunívoca**: Toda alteração de saldo gera obrigatoriamente um lançamento no `WalletLedgerEntry`, e nenhum lançamento no ledger existe sem alteração correspondente.

### 2.3 WagerTransaction e Máquina de Estados Finita
- Estados possíveis:
  * `PENDING`: Transação criada e aceita para processamento.
  * `PENDING_REFERENCE`: Operação dependente (`REFUND` ou `ROLLBACK`) recebida antes da transação de origem (`BET` ou `WIN`).
  * `PROCESSED`: Estado terminal. Transação confirmada com sucesso.
  * `REJECTED`: Estado terminal. Violação de regra de negócio (ex: saldo insuficiente, payload conflitante).
  * `FAILED`: Estado terminal. Falha permanente de infraestrutura.
- Uma vez alcançado um estado terminal (`PROCESSED`, `REJECTED`, `FAILED`), a transação torna-se **estritamente imutável**.

---

## 3. Concorrência Distribuída e Estratégia de Bloqueio

### 3.1 Unidade de Concorrência
A unidade de concorrência é a **`walletId`**. Múltiplas carteiras são processadas em paralelo com throughput máximo, enquanto operações na mesma carteira são serializadas deterministicamente.

### 3.2 Row-Level Locking (`SELECT ... FOR UPDATE`)
- Para garantir que até mesmo 50 requisições simultâneas ou dezenas de instâncias concorrentes não gerem *lost updates* ou saldo negativo, a transação bancária executa:
  ```sql
  SELECT * FROM wallets WHERE id = $1 FOR UPDATE;
  ```
- O banco PostgreSQL adquire um lock exclusivo na linha da wallet durante a transação.
- **Cenário de Teste Obrigatório**:
  - Saldo inicial: R$ 100,00.
  - Duas apostas de R$ 80,00 disparadas simultaneamente.
  - A primeira aposta que obtiver o lock deduz R$ 80,00 (saldo vai para R$ 20,00) e grava o ledger.
  - A segunda aposta adquire o lock em seguida, lê o saldo atualizado de R$ 20,00, detecta fundos insuficientes e é transicionada para `REJECTED` com código `INSUFFICIENT_FUNDS`, sem movimentar o saldo nem duplicar o ledger.

---

## 4. Idempotência Persistente e Hashing Canônico

- **Idempotência Durável**: Não utilizamos Redis ou cache em memória. A idempotência é garantida no PostgreSQL através da constraint única `(provider_id, external_transaction_id)`.
- **Payload Hash Canônico**:
  - Geramos um hash SHA-256 a partir de um JSON canônico (chaves ordenadas lexicograficamente) contendo apenas os dados de negócio (`providerId`, `externalTransactionId`, `playerId`, `walletId`, `roundId`, `gameId`, `kind`, `money`).
- **Comportamento**:
  - **Replay Idêntico**: Mesma chave e mesmo payload -> retorna o resultado original já processado (`idempotentReplay: true`) e o saldo observado naquele instante.
  - **Conflito de Payload**: Mesma chave com payload alterado -> retorna `409 Conflict` imediato (`IDEMPOTENCY_CONFLICT`), impedindo falsificação ou reenvios inconsistentes.

---

## 5. Padrões de Mensageria: Transactional Outbox e Deduplicated Inbox

### 5.1 Transactional Outbox
1. A gravação da transação de aposta, alteração do saldo da carteira, inserção do lançamento no ledger, deduplicação de inbox e gravação do evento na tabela `outbox_messages` ocorrem na **mesma transação SQL**.
2. Se o processo morrer antes de enviar a mensagem ao SQS, os dados continuam intactos.
3. Um worker agendado (`OutboxPublisherWorker`) varre eventos pendentes com `SELECT ... FOR UPDATE SKIP LOCKED`, publica no SQS e marca `published_at = NOW()`.
4. Em caso de indisponibilidade do broker, o worker calcula o próximo agendamento com backoff exponencial e jitter.

### 5.2 Deduplicated Inbox
- Mensagens recebidas do SQS contêm `messageId`.
- Gravamos na tabela `inbox_messages` com chave única `(consumer_name, message_id)`.
- Se uma mensagem for reenviada pela fila (at-least-once delivery), o consumer detecta a chave existente e realiza o `ack` sem reprocessar os efeitos colaterais.

---

## 6. Tratamento de Mensagens Fora de Ordem (`PENDING_REFERENCE`)

Em sistemas de mensageria distribuída at-least-once, um evento de estorno (`REFUND`) pode ser entregue antes do evento de aposta (`BET`).
- Ao receber `REFUND` ou `ROLLBACK` cuja referência não exista no banco, a transação é criada e marcada como `PENDING_REFERENCE`.
- Um worker periódico (`PendingReferenceResolverWorker`) avalia as transações com referência pendente.
- Assim que a transação pai chega e é processada, a dependente é reavaliada e transicionada para `PROCESSED`.
- Caso o TTL (tempo de vida) configurado expire sem que a referência apareça, a transação é finalizada como `REJECTED` com o `failureCode` `REFERENCE_NOT_FOUND` e evento emitido.

---

## 7. Taxonomia de Códigos de Falha (`FailureCode`)

| Código | Descrição |
|---|---|
| `INSUFFICIENT_FUNDS` | Saldo insuficiente para efetuar o débito da aposta |
| `REFERENCE_NOT_FOUND` | Transação referenciada não encontrada ou expirada |
| `REFERENCE_ALREADY_REVERSED` | A transação referenciada já foi estornada anteriormente |
| `INVALID_REFERENCE_KIND` | O tipo da transação referenciada é incompatível com a reversão |
| `INVALID_PAYLOAD` | Dados da requisição inválidos ou fora dos padrões permitidos |
| `IDEMPOTENCY_CONFLICT` | Mesma chave de idempotência reenviada com payload diferente |
| `CURRENCY_MISMATCH` | A moeda informada não coincide com a moeda da carteira ou da referência |
| `ROUND_MISMATCH` | A rodada informada não coincide com a rodada da referência |
| `TERMINAL_STATE_VIOLATION` | Tentativa ilegal de alterar uma transação já finalizada |

