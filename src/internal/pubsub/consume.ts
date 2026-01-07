import amqp from 'amqplib';
import type { Channel } from 'amqplib';
import { ExchangePerilDlx } from '../routing/routing.js';
import { decode } from '@msgpack/msgpack';

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
    arguments: {
      'x-dead-letter-exchange': ExchangePerilDlx,
    },
  });

  await ch.bindQueue(queue.queue, exchange, key);

  return [ch, queue];
}

export enum AckType {
  Ack = 'Ack',
  NackRequeue = 'NackRequeue',
  NackDiscard = 'NackDiscard',
}

export async function subscribe<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  routingKey: string,
  simpleQueueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType,
  unmarshaller: (data: Buffer) => T
): Promise<void> {
  const [channel, queue] = await declareAndBind(
    conn,
    exchange,
    queueName,
    routingKey,
    simpleQueueType
  );

  channel.consume(queue.queue, async (msg: amqp.ConsumeMessage | null) => {
    if (!msg) return;

    let data: T;
    try {
      data = unmarshaller(msg.content);
    } catch (err) {
      console.error('Could not unmarshal message:', err);
      return;
    }

    try {
      const result = await handler(data);
      switch (result) {
        case AckType.Ack:
          channel.ack(msg);
          break;
        case AckType.NackDiscard:
          channel.nack(msg, false, false);
          break;
        case AckType.NackRequeue:
          channel.nack(msg, false, true);
          break;
        default:
          const unreachable: never = result;
          console.error('Unexpected ack type:', unreachable);
          return;
      }
    } catch (err) {
      console.error('Error handling message:', err);
      channel.nack(msg, false, false);
      return;
    }
  });
}

export async function subscribeJSON<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  routingKey: string,
  simpleQueueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType
): Promise<void> {
  return await subscribe<T>(
    conn,
    exchange,
    queueName,
    routingKey,
    simpleQueueType,
    handler,
    (data: Buffer) => JSON.parse(data.toString())
  );
}

export async function subscribeMsgPack<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  routingKey: string,
  simpleQueueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType
): Promise<void> {
  subscribe<T>(
    conn,
    exchange,
    queueName,
    routingKey,
    simpleQueueType,
    handler,
    (data: Buffer) => decode(data) as T
  );
}
