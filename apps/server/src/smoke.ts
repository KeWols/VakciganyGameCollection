/** End-to-end, 20-controller test through actual TCP WebSockets and the configured broker. */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { AVATARS, DEFAULT_SETTINGS } from '../../../packages/shared/config';
import type { Snapshot } from '../../../packages/shared/types';
const port = 3019,
  useRabbit = process.argv.includes('--rabbit');
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
  env: {
    ...process.env,
    PORT: String(port),
    BROKER: useRabbit ? 'rabbitmq' : 'memory',
    MOVIE_SPEED: '.01',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', (d) => {
  logs += d.toString();
});
child.stderr.on('data', (d) => {
  logs += d.toString();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(condition: () => boolean, timeout = 20000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(`Timed out\n${logs}`);
    await sleep(15);
  }
}
const sockets: WebSocket[] = [];
class Client {
  socket: WebSocket;
  state: Snapshot | null = null;
  token = '';
  errors: string[] = [];
  seenMovie = false;
  constructor(role: 'host' | 'player', token?: string) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(this.socket);
    this.socket.on('open', () => this.send('game.connection.hello', { role, token }));
    this.socket.on('error', (e) => this.errors.push(e.message));
    this.socket.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === 'game.error') this.errors.push(event.payload.message);
      if (event.type === 'game.player.identity') this.token = event.payload.token;
      if (event.payload?.state) {
        this.state = event.payload;
        if (this.state?.state.phase === 'ACTION_MOVIE') this.seenMovie = true;
      }
    });
  }
  send(type: string, payload: unknown = {}) {
    this.socket.send(JSON.stringify({ type, payload }));
  }
}
try {
  await until(() => logs.includes('listening'), 30000);
  const host = new Client('host');
  await until(() => host.state !== null);
  const players: Client[] = [];
  for (let i = 0; i < 20; i++) {
    const client = new Client('player');
    await until(() => client.state !== null);
    client.send('game.player.join', {
      name: `Test robber ${i + 1}`,
      avatar: AVATARS[i],
    });
    await until(() => Boolean(client.token));
    players.push(client);
  }
  await until(() => host.state!.state.players.length === 20);
  assert.equal(new Set(host.state!.state.players.map((p) => p.color)).size, 20);
  assert.equal(host.state!.me, null);
  assert(
    host.state!.state.players.every((p) => !('deck' in p) && !('token' in p) && !('program' in p)),
  );
  host.send('game.host.settings.update', {
    ...DEFAULT_SETTINGS,
    rounds: 1,
    selectionSeconds: 180,
    targetSeconds: 3,
  });
  await until(() => host.state!.state.settings.rounds === 1);
  host.send('game.host.start');
  await until(() => players.every((c) => c.state?.state.phase === 'ACTION_SELECTION'));
  const slots = host.state!.state.round.phases.reduce((n, p) => n + p.repeatCount, 0);
  // Sequential command/ack per controller; all twenty controllers program concurrently.
  await Promise.all(
    players.map(async (client) => {
      for (let slot = 0; slot < slots; slot++) {
        client.send('game.action.skip_draw', { slot, skip: true });
        await until(() => client.state!.me!.program.length === slot + 1);
      }
      assert(client.state!.me!.deck.hand.length > 0);
    }),
  );
  const disconnected = players[0];
  const before = disconnected.state!.me;
  disconnected.socket.close();
  const restored = new Client('player', disconnected.token);
  await until(() => restored.state?.playerId === disconnected.state!.playerId);
  assert.deepEqual(restored.state!.me, before);
  players[0] = restored;
  for (const client of players) client.send('game.player.ready');
  await until(() => host.seenMovie);
  await until(() => host.state!.state.phase === 'RESULTS', 30000);
  assert.equal(host.state!.state.round.number, 1);
  assert(players.every((c) => c.seenMovie));
  assert.equal(host.state!.state.players.length, 20);
  assert.equal(host.errors.length, 0, host.errors.join('\n'));
  assert(players.every((c) => c.errors.length === 0));
  console.log(
    `PASS: 20 real WebSocket controllers · ${useRabbit ? 'RabbitMQ' : 'memory'} transport · unique colors · private hands · ${slots} programmed slots each · reconnect · Ready · complete movie · results`,
  );
} finally {
  for (const socket of sockets) socket.close();
  child.kill();
}
