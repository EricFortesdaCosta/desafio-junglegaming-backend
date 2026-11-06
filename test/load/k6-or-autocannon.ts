import { v4 as uuidv4 } from 'uuid';

async function runLoadTest() {
  const targetUrl = process.env.TARGET_URL || 'http://localhost:3000';
  const totalRequests = 200;
  const concurrency = 20;

  console.log(`=======================================================`);
  console.log(` [LOAD TEST] Distributed Wagering Processor Benchmark`);
  console.log(` Target: ${targetUrl}`);
  console.log(` Total Requests: ${totalRequests} | Concurrency: ${concurrency}`);
  console.log(`=======================================================\n`);

  // 1. Setup Wallet with Initial Balance
  const walletRes = await fetch(`${targetUrl}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: `benchmark-player-${uuidv4().substring(0, 8)}`,
      initialBalance: { amount: '10000.00', currency: 'BRL' },
    }),
  });

  if (!walletRes.ok) {
    console.error('Failed to create benchmark wallet:', await walletRes.text());
    process.exit(1);
  }

  const wallet = await walletRes.json();
  const walletId = wallet.id;
  console.log(`Setup Complete: Wallet ${walletId} opened with 10,000.00 BRL\n`);

  const latencies: number[] = [];
  let successfulRequests = 0;
  let rejectedRequests = 0;
  let errorRequests = 0;

  const startTime = Date.now();
  let completed = 0;

  async function worker(workerId: number, requestsPerWorker: number) {
    for (let i = 0; i < requestsPerWorker; i++) {
      const txId = `load-${workerId}-${i}-${uuidv4().substring(0, 6)}`;
      const reqStart = performance.now();

      try {
        const res = await fetch(`${targetUrl}/wagering/transactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': `load-provider:${txId}`,
          },
          body: JSON.stringify({
            providerId: 'load-provider',
            externalTransactionId: txId,
            playerId: wallet.playerId,
            walletId,
            roundId: `round-${workerId}-${i}`,
            gameId: 'benchmark-game',
            kind: 'BET',
            money: { amount: '10.00', currency: 'BRL' },
          }),
        });

        const reqDuration = performance.now() - reqStart;
        latencies.push(reqDuration);

        if (res.status === 200) {
          successfulRequests++;
        } else if (res.status === 422) {
          rejectedRequests++;
        } else {
          errorRequests++;
        }
      } catch (err) {
        errorRequests++;
      }

      completed++;
    }
  }

  const requestsPerWorker = Math.floor(totalRequests / concurrency);
  const workers = Array.from({ length: concurrency }, (_, id) =>
    worker(id, requestsPerWorker),
  );

  await Promise.all(workers);
  const totalDurationMs = Date.now() - startTime;

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const throughput = ((completed / totalDurationMs) * 1000).toFixed(2);

  console.log(`---------------- RESULTS ----------------`);
  console.log(`Completed Requests:   ${completed}`);
  console.log(`Throughput:           ${throughput} req/sec`);
  console.log(`Success (200 OK):     ${successfulRequests}`);
  console.log(`Business Rejected:    ${rejectedRequests}`);
  console.log(`Errors (5xx/Network): ${errorRequests}`);
  console.log(`p50 Latency:          ${p50.toFixed(2)} ms`);
  console.log(`p95 Latency:          ${p95.toFixed(2)} ms`);
  console.log(`p99 Latency:          ${p99.toFixed(2)} ms`);
  console.log(`Total Duration:       ${(totalDurationMs / 1000).toFixed(2)} s`);
  console.log(`-----------------------------------------`);

  // Verify Ledger Consistency after load test
  const recRes = await fetch(`${targetUrl}/wallets/${walletId}/reconciliation`, {
    method: 'POST',
  });
  if (recRes.ok) {
    const rec = await recRes.json();
    console.log(`\nReconciliation check: Consistent=${rec.consistent}, Final Balance=${rec.storedBalance.amount} BRL, Entries=${rec.checkedEntries}`);
  }
}

runLoadTest().catch((err) => {
  console.error('Load test failed:', err);
});

