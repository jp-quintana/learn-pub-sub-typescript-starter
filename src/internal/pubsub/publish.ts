import type { ConfirmChannel } from 'amqplib';
import { encode } from '@msgpack/msgpack';

export function publishMsgPack<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T
): Promise<void> {
  return new Promise((resolve, reject) => {
    const encoded: Uint8Array = encode(value);

    const content: Buffer = Buffer.from(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength
    );

    ch.publish(
      exchange,
      routingKey,
      content,
      { contentType: 'application/msgpack' },
      (err) => {
        if (err !== null) {
          reject(new Error('Message was NACKed by the broker'));
        } else {
          resolve();
        }
      }
    );
  });
}

export function publishJSON<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T
): Promise<void> {
  return new Promise((resolve, reject) => {
    const content = Buffer.from(JSON.stringify(value));

    ch.publish(
      exchange,
      routingKey,
      content,
      { contentType: 'application/json' },
      (err) => {
        if (err !== null) {
          reject(new Error('Message was NACKed by the broker'));
        } else {
          resolve();
        }
      }
    );
  });
}
