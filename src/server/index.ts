import amqp from 'amqplib';
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  GameLogSlug,
  PauseKey,
} from '../internal/routing/routing.js';
import { publishJSON } from '../internal/pubsub/publish.js';
import { getInput, printServerHelp } from '../internal/gamelogic/gamelogic.js';
import {
  AckType,
  declareAndBind,
  SimpleQueueType,
  subscribeMsgPack,
} from '../internal/pubsub/consume.js';
import { writeLog, type GameLog } from '../internal/gamelogic/logs.js';

async function main() {
  const rabbitConnString = 'amqp://guest:guest@localhost:5672/';
  const conn = await amqp.connect(rabbitConnString);
  console.log('Peril game server connected to RabbitMQ!');

  ['SIGINT', 'SIGTERM'].forEach((signal) =>
    process.on(signal, async () => {
      try {
        await conn.close();
        console.log('RabbitMQ connection closed.');
      } catch (err) {
        console.error('Error closing RabbitMQ connection:', err);
      } finally {
        process.exit(0);
      }
    })
  );

  const confirmChannel = await conn.createConfirmChannel();

  subscribeMsgPack<GameLog>(
    conn,
    ExchangePerilTopic,
    GameLogSlug,
    `${GameLogSlug}.*`,
    SimpleQueueType.Durable,
    async (gameLog: GameLog): Promise<AckType> => {
      try {
        await writeLog(gameLog);
        return AckType.Ack;
      } catch (err) {
        console.error('Error writing game log:', err);
        return AckType.NackRequeue;
      } finally {
        process.stdout.write('> ');
      }
    }
  );

  printServerHelp();

  while (true) {
    const words = await getInput();
    if (words.length === 0) continue;

    const command = words[0];
    if (command === 'pause') {
      console.log('Publishing paused game state');
      try {
        await publishJSON(confirmChannel, ExchangePerilDirect, PauseKey, {
          isPaused: true,
        });
      } catch (err) {
        console.error('Error publishing pause message:', err);
      }
    } else if (command === 'resume') {
      console.log('Publishing resumed game state');
      try {
        await publishJSON(confirmChannel, ExchangePerilDirect, PauseKey, {
          isPaused: false,
        });
      } catch (err) {
        console.error('Error publishing resume message:', err);
      }
    } else if (command === 'quit') {
      console.log('Goodbye!');
      process.exit(0);
    } else {
      console.log('Unknown command');
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
