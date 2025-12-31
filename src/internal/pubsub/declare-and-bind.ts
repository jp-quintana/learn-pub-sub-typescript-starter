import amqp from 'amqplib';
import type { Channel } from 'amqplib';

export enum SimpleQueueType {
  Durable = 'durable',
  Transient = 'transient',
}

export async function declareAndBind(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType
): Promise<[Channel, amqp.Replies.AssertQueue]> {
  const ch = await conn.createChannel();
  const isDurable = queueType === SimpleQueueType.Durable;

  const queue = await ch.assertQueue(queueName, {
    durable: isDurable,
    autoDelete: !isDurable,
    exclusive: !isDurable,
  });

  await ch.bindQueue(queue.queue, exchange, key);

  return [ch, queue];
}
