import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { createBroker, type Broker } from './broker';
import { Engine } from './engine';
const app = express(),
  http = createServer(app),
  sockets = new Map<string, WebSocket>();
let broker: Broker;
const movieSpeed = Number(process.env.MOVIE_SPEED ?? 1);
if (!Number.isFinite(movieSpeed) || movieSpeed < 0.01 || movieSpeed > 3)
  throw new Error('MOVIE_SPEED must be between 0.01 and 3');
const engine = new Engine((event) => broker.event(event), 'rabbitmq', undefined, movieSpeed);
try {
  broker = await createBroker(
    (c) => engine.command(c),
    (event) => {
      if (event.connectionId) {
        const socket = sockets.get(event.connectionId);
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event.envelope));
      }
    },
  );
} catch (error) {
  console.error(
    'RabbitMQ is required by default. Run docker compose up -d, or explicitly set BROKER=memory for local-only development.\n',
    error,
  );
  process.exit(1);
}
engine.broker = broker.name;
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    broker: broker.name,
    players: engine.state.players.length,
    phase: engine.state.phase,
  }),
);
app.get('/api/avatar/:id', (req, res) => {
  const p = engine.state.players.find((p) => p.id === req.params.id);
  const match = p?.avatar.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) {
    res.sendStatus(404);
    return;
  }
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(match[2], 'base64'));
});
app.get('/api/network', (_req, res) =>
  res.json({
    addresses: Object.values(networkInterfaces())
      .flat()
      .filter((n) => n?.family === 'IPv4' && !n.internal)
      .map((n) => n!.address),
  }),
);
const staticRoot = path.resolve('dist/client');
if (existsSync(staticRoot)) {
  app.use(express.static(staticRoot));
  app.get('*', (_req, res) => res.sendFile(path.join(staticRoot, 'index.html')));
}
const wss = new WebSocketServer({
  server: http,
  path: '/ws',
  maxPayload: 220000,
});
wss.on('connection', (socket) => {
  const id = randomUUID();
  sockets.set(id, socket);
  let budget = 35,
    alive = true;
  const interval = setInterval(() => {
    budget = 35;
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, 10000);
  socket.on('pong', () => {
    alive = true;
  });
  socket.on('message', (data) => {
    if (--budget < 0) {
      socket.send(
        JSON.stringify({
          type: 'game.error',
          payload: { message: 'Too many commands. Please slow down.' },
          serverTime: Date.now(),
        }),
      );
      return;
    }
    try {
      const message = JSON.parse(data.toString());
      if (
        typeof message.type !== 'string' ||
        message.type.length > 80 ||
        message.type === 'game.connection.closed'
      )
        throw new Error();
      broker.command({
        connectionId: id,
        type: message.type,
        payload: message.payload,
      });
    } catch {
      socket.send(
        JSON.stringify({
          type: 'game.error',
          payload: { message: 'Invalid message' },
          serverTime: Date.now(),
        }),
      );
    }
  });
  socket.on('error', console.error);
  socket.on('close', () => {
    clearInterval(interval);
    sockets.delete(id);
    broker.command({
      connectionId: id,
      type: 'game.connection.closed',
      payload: {},
    });
  });
});
const port = Number(process.env.PORT ?? 3001);
http.listen(port, '0.0.0.0', () =>
  console.log(`Midnight Withdrawal server listening on :${port} · ${broker.name}`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    engine.dispose();
    wss.close();
    http.close();
    void broker.close().finally(() => process.exit(0));
  });
