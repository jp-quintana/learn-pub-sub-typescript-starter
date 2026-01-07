import amqp, { type ConfirmChannel } from 'amqplib';
import {
  clientWelcome,
  commandStatus,
  getInput,
  printClientHelp,
  printQuit,
} from '../internal/gamelogic/gamelogic.js';
import {
  AckType,
  declareAndBind,
  SimpleQueueType,
  subscribeJSON,
} from '../internal/pubsub/consume.js';
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  GameLogSlug,
  PauseKey,
  WarRecognitionsPrefix,
} from '../internal/routing/routing.js';
import {
  GameState,
  type PlayingState,
} from '../internal/gamelogic/gamestate.js';
import { commandSpawn } from '../internal/gamelogic/spawn.js';
import {
  commandMove,
  handleMove,
  MoveOutcome,
} from '../internal/gamelogic/move.js';
import { handlePause } from '../internal/gamelogic/pause.js';
import type {
  ArmyMove,
  RecognitionOfWar,
} from '../internal/gamelogic/gamedata.js';
import { publishJSON, publishMsgPack } from '../internal/pubsub/publish.js';
import { handleWar, WarOutcome } from '../internal/gamelogic/war.js';
import type { GameLog } from '../internal/gamelogic/logs.js';

const pauseHandler = (gs: GameState): ((ps: PlayingState) => AckType) => {
  return (ps: PlayingState) => {
    handlePause(gs, ps);
    process.stdout.write('> ');
    return AckType.Ack;
  };
};

const moveHandler = (
  gs: GameState,
  confirmChannel: ConfirmChannel
): ((move: ArmyMove) => Promise<AckType>) => {
  return async (move: ArmyMove): Promise<AckType> => {
    try {
      const moveOutcome = handleMove(gs, move);
      switch (moveOutcome) {
        case MoveOutcome.Safe:
          return AckType.Ack;

        case MoveOutcome.MakeWar:
          try {
            await publishJSON(
              confirmChannel,
              ExchangePerilTopic,
              `${WarRecognitionsPrefix}.${gs.getUsername()}`,
              {
                attacker: move.player,
                defender: gs.getPlayerSnap(),
              }
            );
            return AckType.Ack;
          } catch (err) {
            console.error('Error publishing war recognition:', err);
            return AckType.NackRequeue;
          }

        default:
          return AckType.NackDiscard;
      }
    } finally {
      process.stdout.write('> ');
    }
  };
};

const warHandler = (
  gs: GameState,
  confirmChannel: ConfirmChannel
): ((rw: RecognitionOfWar) => Promise<AckType>) => {
  return async (rw: RecognitionOfWar): Promise<AckType> => {
    try {
      const outcome = handleWar(gs, rw);
      switch (outcome.result) {
        case WarOutcome.NotInvolved:
          return AckType.NackRequeue;

        case WarOutcome.NoUnits:
          return AckType.NackDiscard;

        case WarOutcome.OpponentWon:
        case WarOutcome.YouWon:
          try {
            await publishGameLog(
              confirmChannel,
              rw.attacker.username,
              `${outcome.winner} won a war against ${outcome.loser}`
            );
            return AckType.Ack;
          } catch (err) {
            console.error('Error publishing war recognition:', err);
            return AckType.NackRequeue;
          }

        case WarOutcome.Draw:
          try {
            await publishGameLog(
              confirmChannel,
              rw.attacker.username,
              `A war between ${rw.attacker.username} and ${rw.defender.username} resulted in a draw`
            );
            return AckType.Ack;
          } catch (err) {
            console.error('Error publishing war recognition:', err);
            return AckType.NackRequeue;
          }

        default:
          console.log('Unexpected war resolution');
          return AckType.NackDiscard;
      }
    } finally {
      process.stdout.write('> ');
    }
  };
};

const publishGameLog = async (
  confirmChannel: ConfirmChannel,
  username: string,
  message: string
) => {
  const gameLog: GameLog = {
    currentTime: new Date(),
    username,
    message,
  };
  return await publishMsgPack<GameLog>(
    confirmChannel,
    ExchangePerilTopic,
    `${GameLogSlug}.${username}`,
    gameLog
  );
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

  await subscribeJSON<PlayingState>(
    conn,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.Transient,
    pauseHandler(gs)
  );

  await subscribeJSON<ArmyMove>(
    conn,
    ExchangePerilTopic,
    `army_moves.${username}`,
    'army_moves.*',
    SimpleQueueType.Transient,
    moveHandler(gs, confirmChannel)
  );

  await subscribeJSON<RecognitionOfWar>(
    conn,
    ExchangePerilTopic,
    WarRecognitionsPrefix,
    `${WarRecognitionsPrefix}.*`,
    SimpleQueueType.Durable,
    warHandler(gs, confirmChannel)
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
