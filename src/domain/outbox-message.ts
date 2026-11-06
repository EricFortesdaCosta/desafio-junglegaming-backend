import { v4 as uuidv4 } from 'uuid';
import { IntegrationEvent } from './events/integration-event';

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private static readonly BASE_BACKOFF_MS = 1000;
  private static readonly MAX_BACKOFF_MS = 60000;

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: Readonly<Record<string, unknown>>,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  public static enqueue(event: IntegrationEvent<unknown>, id: string = uuidv4()): OutboxMessage {
    return new OutboxMessage(
      id,
      event.aggregateId,
      event.eventType,
      event.toJSON(),
      event.occurredAt,
      0,
      new Date(), // immediately due
      undefined,
    );
  }

  public static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  public get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date = new Date()): boolean {
    if (this._publishedAt !== undefined) {
      return false;
    }
    if (!this._nextAttemptAt) {
      return true;
    }
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  public markPublished(at: Date = new Date()): void {
    this._publishedAt = at;
  }

  public scheduleRetry(now: Date = new Date()): void {
    this._attempts += 1;
    // Exponential backoff: base * 2^(attempts-1) with jitter
    const delay = Math.min(
      OutboxMessage.BASE_BACKOFF_MS * Math.pow(2, this._attempts - 1),
      OutboxMessage.MAX_BACKOFF_MS,
    );
    const jitter = Math.floor(Math.random() * (delay * 0.2));
    this._nextAttemptAt = new Date(now.getTime() + delay + jitter);
  }
}

