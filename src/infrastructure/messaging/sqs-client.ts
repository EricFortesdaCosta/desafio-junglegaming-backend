import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { MessagePublisherPort } from '../../application/ports/ports';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/process-wager-transaction.use-case';

export class SqsMessagePublisher implements MessagePublisherPort {
  private client: SQSClient;

  constructor(endpoint: string = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566') {
    this.client = new SQSClient({
      endpoint,
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
  }

  public async publish(queueUrl: string, message: unknown): Promise<void> {
    const isFifo = queueUrl.endsWith('.fifo');
    const body = JSON.stringify(message);

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
      ...(isFifo
        ? {
            MessageGroupId: 'wager-group',
            MessageDeduplicationId: (message as any)?.eventId ?? `${Date.now()}-${Math.random()}`,
          }
        : {}),
    });

    await this.client.send(command);
  }
}

export class MockMessagePublisher implements MessagePublisherPort {
  public published: Array<{ queueUrl: string; message: unknown }> = [];

  public async publish(queueUrl: string, message: unknown): Promise<void> {
    this.published.push({ queueUrl, message });
  }

  public clear(): void {
    this.published = [];
  }
}

export class SqsConsumer {
  private client: SQSClient;
  private isPolling = false;

  constructor(
    private readonly queueUrl: string,
    private readonly processUseCase: ProcessWagerTransactionUseCase,
    endpoint: string = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
  ) {
    this.client = new SQSClient({
      endpoint,
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
  }

  public async pollOnce(): Promise<number> {
    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );

      if (!response.Messages || response.Messages.length === 0) {
        return 0;
      }

      for (const msg of response.Messages) {
        if (!msg.Body || !msg.ReceiptHandle) continue;

        try {
          const parsed = JSON.parse(msg.Body);
          if (parsed.type === 'WagerTransactionRequested' && parsed.data) {
            await this.processUseCase.execute({
              ...parsed.data,
              sqsMessageId: msg.MessageId,
            });
          }

          // Acknowledge ONLY after successful commit
          await this.client.send(
            new DeleteMessageCommand({
              QueueUrl: this.queueUrl,
              ReceiptHandle: msg.ReceiptHandle,
            }),
          );
        } catch (err) {
          console.error(`[SqsConsumer] Error processing SQS message ${msg.MessageId}:`, err);
          // Let message visibility expire or move to DLQ
        }
      }

      return response.Messages.length;
    } catch (err) {
      // SQS might not be reachable in pure local dev
      return 0;
    }
  }
}

