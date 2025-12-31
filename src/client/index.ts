import amqp from 'amqplib';
import {
  clientWelcome,
  commandStatus,
  getInput,
  printClientHelp,
  printQuit,
} from '../internal/gamelogic/gamelogic.js';
import {
  declareAndBind,
  SimpleQueueType,
} from '../internal/pubsub/declare-and-bind.js';
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  PauseKey,
} from '../internal/routing/routing.js';
import {
  GameState,
  type PlayingState,
} from '../internal/gamelogic/gamestate.js';
import { commandSpawn } from '../internal/gamelogic/spawn.js';
import { commandMove, handleMove } from '../internal/gamelogic/move.js';
import { handlePause } from '../internal/gamelogic/pause.js';
import { subscribeJSON } from '../internal/pubsub/subscribe-json.js';
import type { ArmyMove } from '../internal/gamelogic/gamedata.js';
import { publishJSON } from '../internal/pubsub/publish-json.js';

const handlerPause = (gs: GameState): ((ps: PlayingState) => void) => {
  return (ps: PlayingState) => {
    handlePause(gs, ps);
    console.log('> ');
  };
};

const handlerMove = (gs: GameState): ((move: ArmyMove) => void) => {
  return (move: ArmyMove) => {
    handleMove(gs, move);
    console.log('> ');
  };
};

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

  const username = await clientWelcome();

  const confirmChannel = await conn.createConfirmChannel();

  await declareAndBind(
    conn,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.Transient
  );

  const gs = new GameState(username);

  subscribeJSON<PlayingState>(
    conn,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.Transient,
    handlerPause(gs)
  );

  subscribeJSON<ArmyMove>(
    conn,
    ExchangePerilTopic,
    `army_moves.${username}`,
    'army_moves.*',
    SimpleQueueType.Transient,
    handlerMove(gs)
  );

  while (true) {
    const words = await getInput();
    if (words.length === 0) {
      continue;
    }
    const command = words[0];
    if (command === 'move') {
      try {
        const armyMove = commandMove(gs, words);
        await publishJSON(
          confirmChannel,
          ExchangePerilTopic,
          `army_moves.${username}`,
          armyMove
        );
      } catch (err) {
        console.log((err as Error).message);
      }
    } else if (command === 'status') {
      commandStatus(gs);
    } else if (command === 'spawn') {
      try {
        commandSpawn(gs, words);
      } catch (err) {
        console.log((err as Error).message);
      }
    } else if (command === 'help') {
      printClientHelp();
    } else if (command === 'quit') {
      printQuit();
      process.exit(0);
    } else if (command === 'spam') {
      console.log('Spamming not allowed yet!');
    } else {
      console.log('Unknown command');
      continue;
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
