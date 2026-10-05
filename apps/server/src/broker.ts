import amqp from 'amqplib';
import type { Command } from '../../../packages/shared/types';
import type { EngineEvent } from './engine';
export interface Broker {
  name: string;
  command: (command: Command) => void;
  event: (event: EngineEvent) => void;
  close: () => Promise<void>;
}
export async function createBroker(
  onCommand: (command: Command) => Promise<void>,
  onEvent: (event: EngineEvent) => void,
): Promise<Broker> {
  if (process.env.BROKER === 'memory') {
    // Explicit opt-in development transport, with the same ordered gateway interface.
    let chain = Promise.resolve();
    return {
      name: 'memory (development)',
      command: (c) => {
        chain = chain.then(() => onCommand(c)).catch(console.error);
      },
      event: onEvent,
      close: async () => {
        await chain;
      },
    };
  }
  const connection = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://localhost');
  const commands = await connection.createChannel(),
    events = await connection.createChannel();
  await commands.assertExchange('game.commands', 'topic', { durable: false });
  await events.assertExchange('game.events', 'topic', { durable: false });
  // A single exclusive command queue prevents accidentally running two engines for one session.
  const queue = await commands.assertQueue('midnight.prototype.commands', {
    exclusive: true,
    autoDelete: true,
    durable: false,
  });
  await commands.bindQueue(queue.queue, 'game.commands', 'game.#');
  await commands.prefetch(1);
  const eventQueue = await events.assertQueue('', { exclusive: true });
  await events.bindQueue(eventQueue.queue, 'game.events', 'game.#');
  await commands.consume(queue.queue, async (message) => {
    if (!message) return;
    try {
      await onCommand(JSON.parse(message.content.toString()) as Command);
      commands.ack(message);
    } catch (e) {
      console.error(e);
      commands.nack(message, false, false);
    }
  });
  await events.consume(eventQueue.queue, (message) => {
    if (!message) return;
    try {
      onEvent(JSON.parse(message.content.toString()) as EngineEvent);
    } finally {
      events.ack(message);
    }
  });
  connection.on('error', (e) => console.error('RabbitMQ error', e));
  connection.on('close', () => {
    console.error('RabbitMQ disconnected. Restart the server to create a fresh session.');
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 100);
  });
  return {
    name: 'rabbitmq',
    command: (c) => {
      commands.publish('game.commands', c.type, Buffer.from(JSON.stringify(c)));
    },
    event: (e) => {
      events.publish('game.events', e.envelope.type, Buffer.from(JSON.stringify(e)));
    },
    close: async () => {
      await connection.close();
    },
  };
}
