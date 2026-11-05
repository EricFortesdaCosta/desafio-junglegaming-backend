import { OutboxRepositoryPort, MessagePublisherPort } from '../../application/ports/ports';

export class OutboxPublisherWorker {
  private isRunning = false;
  private timer: Timer | null = null;

  constructor(
    private readonly outboxRepo: OutboxRepositoryPort,
    private readonly messagePublisher: MessagePublisherPort,
    private readonly queueUrl: string = 'http://localhost:4566/000000000000/wager-transactions.fifo',
    private readonly pollIntervalMs: number = 1000,
  ) {}

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => this.processDueMessages(), this.pollIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async processDueMessages(): Promise<number> {
    const due = await this.outboxRepo.findDueMessages(20);
    let publishedCount = 0;

    for (const msg of due) {
      try {
        await this.messagePublisher.publish(this.queueUrl, msg.payload);
        msg.markPublished(new Date());
        await this.outboxRepo.update(msg);
        publishedCount++;
      } catch (err) {
        msg.scheduleRetry(new Date());
        await this.outboxRepo.update(msg);
        console.error(`[OutboxPublisher] Failed to publish message ${msg.id}:`, err);
      }
    }

    return publishedCount;
  }
}
