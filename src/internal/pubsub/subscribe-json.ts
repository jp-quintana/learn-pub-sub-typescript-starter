import amqp from 'amqplib';

import { declareAndBind, type SimpleQueueType } from './declare-and-bind.js';

export async function subscribeJSON<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
  handler: (data: T) => void
): Promise<void> {
  const [channel, queue] = await declareAndBind(
    conn,
    exchange,
    queueName,
    key,
    queueType
  );

  channel.consume(queue.queue, (msg: amqp.ConsumeMessage | null) => {
    if (msg) {
      const p = JSON.parse(msg.content.toString());
      handler(p);
      channel.ack(msg);
    }
  });
}
