import { resolveAction } from './actions';
import { createHash, randomUUID } from 'node:crypto';
import { predictedOrigin, refreshPredictions } from '../../../packages/shared/prediction';
import {
  BALANCE,
  DEFAULT_SETTINGS,
  LABELS,
  PALETTE,
  TIMING,
} from '../../../packages/shared/config';
import {
  ROOMS,
  center,
  roomById,
  route,
  squareById,
  type LogicalSquare,
} from '../../../packages/shared/map';
import type {
  Command,
  Envelope,
  GameState,
  PlayerState,
  ProgrammedAction,
  Snapshot,
} from '../../../packages/shared/types';
import {
  arrests,
  autoFill,
  choose,
  createDeck,
  draw,
  lootValue,
  movieOrder,
  phases,
  random,
  score,
  shuffle,
  spawn,
  usable,
  type Random,
} from './rules';
import {
  emojiSchema,
  helloSchema,
  joinSchema,
  kickSchema,
  profileSchema,
  programSchema,
  settingsSchema,
  targetSchema,
} from './validation';
export interface EngineEvent {
  connectionId?: string;
  envelope: Envelope;
}
type Session = { role: 'host' | 'player'; playerId?: string };
export class Engine {
  state: GameState = {
    phase: 'LOBBY',
    settings: structuredClone(DEFAULT_SETTINGS),
    players: [],
    loot: [],
    sheriffSquareId: center('room-10').id,
    round: { number: 0, order: [], phases: [] },
    phaseStartedAt: 0,
    phaseEndsAt: 0,
    current: null,
    target: null,
    wheel: null,
    motions: [],
    effect: null,
    log: [],
  };
  sessions = new Map<string, Session>();
  private targetResolve: ((id: string) => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  constructor(
    private publish: (event: EngineEvent) => void,
    public broker = 'rabbitmq',
    public rng: Random = random,
    private speed = 1,
  ) {}
  private send(connectionId: string, type: string, payload: unknown) {
    this.publish({
      connectionId,
      envelope: { type, payload, serverTime: Date.now() },
    });
  }
  snapshot(connectionId: string): Snapshot {
    const session = this.sessions.get(connectionId),
      p = this.state.players.find((p) => p.id === session?.playerId);
    const { players, target, ...rest } = this.state;
    return {
      state: {
        ...structuredClone(rest),
        players: players.map(
          ({ token, deck, program, reshuffleUntil, lastEmojiAt, ...publicPlayer }) => ({
            ...structuredClone(publicPlayer),
            avatar: publicPlayer.avatar.startsWith('data:')
              ? `/api/avatar/${publicPlayer.id}?v=${createHash('sha1').update(publicPlayer.avatar).digest('hex').slice(0, 12)}`
              : publicPlayer.avatar,
            programmedCount: program.length,
            lootValue: lootValue(publicPlayer),
            score: score({
              ...publicPlayer,
              token,
              deck,
              program,
              reshuffleUntil,
              lastEmojiAt,
            }),
          }),
        ),
        target: target ? { playerId: target.playerId, endsAt: target.endsAt } : null,
      },
      me: p
        ? structuredClone({
            deck: p.deck,
            program: p.program,
            reshuffleUntil: p.reshuffleUntil,
            target: target?.playerId === p.id ? target : null,
          })
        : null,
      playerId: p?.id ?? null,
      serverTime: Date.now(),
      broker: this.broker,
    };
  }
  broadcast(type = 'game.state.updated') {
    for (const id of this.sessions.keys()) this.send(id, type, this.snapshot(id));
  }
  private event(kind: string, text: string, actorId = '', targetId?: string) {
    this.state.effect = {
      id: randomUUID(),
      kind,
      actorId,
      targetId,
      text,
      at: Date.now(),
    };
    this.state.log = [text, ...this.state.log].slice(0, 40);
    this.broadcast(`game.${kind}`);
  }
  private later(fn: () => void, ms: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }
  private wait(ms: number) {
    return new Promise<void>((resolve) => this.later(resolve, ms * this.speed));
  }
  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.generation++;
  }
  private player(id: string) {
    const p = this.state.players.find((p) => p.id === this.sessions.get(id)?.playerId);
    if (!p) throw new Error('Join the crew first');
    return p;
  }
  private host(id: string) {
    if (this.sessions.get(id)?.role !== 'host') throw new Error('Host command only');
  }
  private selection(p: PlayerState) {
    if (this.state.phase !== 'ACTION_SELECTION' || p.ready || Date.now() >= this.state.phaseEndsAt)
      throw new Error('Action selection is locked');
  }
  async command(command: Command) {
    const { connectionId: id, type, payload } = command;
    try {
      if (type === 'game.connection.hello') {
        const data = helloSchema.parse(payload);
        if (data.role === 'host' && process.env.HOST_KEY && data.hostKey !== process.env.HOST_KEY)
          throw new Error('Host key is incorrect');
        const p = data.token ? this.state.players.find((p) => p.token === data.token) : undefined;
        this.sessions.set(id, {
          role: data.role,
          playerId: data.role === 'player' ? p?.id : undefined,
        });
        if (p && data.role === 'player') p.connected = true;
        this.broadcast('game.connection.restored');
        return;
      }
      if (type === 'game.connection.closed') {
        const session = this.sessions.get(id);
        this.sessions.delete(id);
        const p = this.state.players.find((p) => p.id === session?.playerId);
        if (p) p.connected = [...this.sessions.values()].some((s) => s.playerId === p.id);
        this.broadcast('game.player.connection_changed');
        return;
      }
      if (!this.sessions.has(id)) throw new Error('Connection has not initialized');
      if (type === 'game.player.join') {
        if (this.sessions.get(id)?.role !== 'player')
          throw new Error('Use the player controller to join');
        if (this.sessions.get(id)?.playerId) throw new Error('Already joined');
        if (this.state.phase !== 'LOBBY') throw new Error('The heist has already started');
        if (this.state.players.length >= BALANCE.maxPlayers)
          throw new Error('The crew is full (20 players)');
        const data = joinSchema.parse(payload);
        const p: PlayerState = {
          id: randomUUID(),
          token: randomUUID(),
          name: data.name,
          avatar: data.avatar,
          color: PALETTE.find((color) => !this.state.players.some((p) => p.color === color))!,
          squareId: '',
          loot: [],
          hitsDealt: 0,
          shots: 0,
          hitsReceived: 0,
          arrests: 0,
          junk: 0,
          deck: createDeck(this.state.settings, this.rng),
          program: [],
          ready: false,
          connected: true,
          reshuffleUntil: 0,
          lastEmojiAt: 0,
        };
        this.state.players.push(p);
        this.sessions.set(id, { role: 'player', playerId: p.id });
        this.send(id, 'game.player.identity', {
          token: p.token,
          playerId: p.id,
        });
        this.event('player.joined', `${p.name} joined the crew`, p.id);
        return;
      }
      if (type === 'game.host.player.kick') {
        this.host(id);
        if (this.state.phase !== 'LOBBY')
          throw new Error('Players can only be kicked in the pregame lobby');
        const { playerId } = kickSchema.parse(payload);
        const removed = this.state.players.find((p) => p.id === playerId);
        if (!removed) throw new Error('Player not found');
        this.state.players = this.state.players.filter((p) => p.id !== playerId);
        for (const [connectionId, session] of this.sessions) {
          if (session.playerId !== playerId) continue;
          session.playerId = undefined;
          this.send(connectionId, 'game.player.kicked', {
            message: 'The host removed you from the lobby.',
          });
        }
        this.event('player.removed', `${removed.name} was removed from the lobby`);
        return;
      }
      if (type === 'game.host.settings.update') {
        this.host(id);
        if (this.state.phase !== 'LOBBY') throw new Error('Settings are locked');
        this.state.settings = settingsSchema.parse(payload);
        this.broadcast();
        return;
      }
      if (type === 'game.host.start') {
        this.host(id);
        if (this.state.phase !== 'LOBBY' || !this.state.players.length)
          throw new Error('Join at least one player before starting');
        settingsSchema.parse(this.state.settings);
        this.start();
        return;
      }
      if (type === 'game.host.reset') {
        this.host(id);
        if (this.state.phase !== 'RESULTS') throw new Error('Finish this heist first');
        this.state.phase = 'LOBBY';
        this.state.round = { number: 0, order: [], phases: [] };
        this.state.loot = [];
        this.state.current = null;
        this.state.motions = [];
        for (const p of this.state.players) {
          p.squareId = '';
          p.ready = false;
          p.program = [];
          p.loot = [];
          p.hitsDealt = p.hitsReceived = p.shots = p.arrests = p.junk = 0;
        }
        this.broadcast();
        return;
      }
      const p = this.player(id);
      if (type === 'game.player.profile.update') {
        if (this.state.phase !== 'LOBBY' && this.state.phase !== 'RESULTS')
          throw new Error('Profiles can only change between heists');
        const data = profileSchema.parse(payload);
        p.name = data.name;
        if (data.avatar) p.avatar = data.avatar;
        this.broadcast('game.player.profile.updated');
        return;
      }
      if (type === 'game.action.program' || type === 'game.action.skip_draw') {
        this.selection(p);
        const data = programSchema.parse(payload);
        const slots = this.state.round.phases.reduce((n, f) => n + f.repeatCount, 0);
        if (data.slot > p.program.length || data.slot >= slots)
          throw new Error('Fill action slots in order');
        const old = p.program[data.slot];
        if (old?.type === 'SKIP') throw new Error('Skip & Draw is permanently locked');
        let action: ProgrammedAction;
        if (data.skip || type === 'game.action.skip_draw') action = { type: 'SKIP' };
        else {
          const card =
            p.deck.hand.find((c) => c.id === data.cardId) ??
            (old?.card?.id === data.cardId ? old.card : undefined);
          if (!card || !usable(card))
            throw new Error('That card is not playable or not in your hand');
          action = { type: card.type as ProgrammedAction['type'], card };
          if (action.type === 'MOVE') {
            if (!data.direction || !data.distance) throw new Error('Choose direction and distance');
            action.direction = data.direction;
            action.distance = data.distance;
          }
          if (action.type === 'GO_OTHER_ROOM') {
            if (
              !data.destinationRoomId ||
              !roomById[
                squareById[predictedOrigin(p.squareId, p.program, data.slot)].roomId
              ].connectedRoomIds.includes(data.destinationRoomId)
            )
              throw new Error('Choose a connected adjacent room');
            action.destinationRoomId = data.destinationRoomId;
          }
        }
        if (old?.card) p.deck.hand.push(old.card);
        if (action.card) p.deck.hand = p.deck.hand.filter((c) => c.id !== action.card!.id);
        p.program[data.slot] = action;
        refreshPredictions(p.squareId, p.program);
        if (action.type === 'SKIP') draw(p.deck, 1, this.rng);
        p.reshuffleUntil = 0;
        this.broadcast('game.action.programmed');
        return;
      }
      if (type === 'game.player.reshuffle') {
        this.selection(p);
        if (p.program.length || Date.now() >= p.reshuffleUntil)
          throw new Error('Reshuffle offer has expired');
        p.deck.draw = shuffle([...p.deck.draw, ...p.deck.hand], this.rng);
        p.deck.hand = [];
        draw(p.deck, this.state.round.phases.length + 1, this.rng);
        p.reshuffleUntil = 0;
        this.broadcast();
        return;
      }
      if (type === 'game.player.ready') {
        this.selection(p);
        if (p.program.length !== this.state.round.phases.reduce((n, f) => n + f.repeatCount, 0))
          throw new Error('Program every action before getting ready');
        p.ready = true;
        this.broadcast('game.player.ready_changed');
        if (this.state.players.every((x) => x.ready)) this.beginMovie();
        return;
      }
      if (type === 'game.target.select') {
        const data = targetSchema.parse(payload),
          target = this.state.target;
        if (
          !target ||
          target.playerId !== p.id ||
          Date.now() >= target.endsAt ||
          !target.candidates.includes(data.targetId)
        )
          throw new Error('This target is not eligible');
        this.targetResolve?.(data.targetId);
        return;
      }
      if (type === 'game.emoji.send') {
        const data = emojiSchema.parse(payload);
        if (this.state.phase !== 'ACTION_MOVIE' || Date.now() - p.lastEmojiAt < 650) return;
        p.lastEmojiAt = Date.now();
        for (const [cid, s] of this.sessions)
          if (s.role === 'host')
            this.send(cid, 'game.emoji.sent', {
              playerId: p.id,
              emoji: data.emoji,
            });
        return;
      }
      throw new Error('Unknown command');
    } catch (error) {
      this.send(id, 'game.error', {
        message: error instanceof Error ? error.message : 'Invalid command',
      });
    }
  }
  start() {
    this.generation++;
    const assigned: PlayerState[] = [];
    for (const p of this.state.players) {
      p.squareId = spawn(assigned, this.rng);
      assigned.push(p);
      p.deck = createDeck(this.state.settings, this.rng);
      p.loot = [];
      p.program = [];
      p.hitsDealt = p.hitsReceived = p.shots = p.arrests = p.junk = 0;
    }
    // Start the Sheriff in the vault so initial spawn cannot arrest anyone.
    this.state.sheriffSquareId = center('room-11').id;
    this.state.loot = Array.from({ length: this.state.settings.lootCount }, (_, i) => {
      const room =
        i % 4 === 0
          ? roomById['room-11']
          : choose(
              ROOMS.filter((r) => !r.isHoldingRoom && !r.isTreasureRoom),
              this.rng,
            );
      return {
        id: randomUUID(),
        kind: room.isTreasureRoom ? choose([3, 4, 5], this.rng) : choose([0, 1, 2, 3, 4], this.rng),
        squareId: choose(room.logicalSquares, this.rng).id,
      };
    });
    this.state.round.number = 0;
    this.prepareRound();
  }
  prepareRound() {
    if (this.state.round.number >= this.state.settings.rounds) {
      this.state.phase = 'RESULTS';
      this.state.current = null;
      this.state.phaseEndsAt = 0;
      this.event('completed', 'The heist is over. Time to count the take.');
      return;
    }
    const now = Date.now();
    this.state.round = {
      number: this.state.round.number + 1,
      order: shuffle(
        this.state.players.map((p) => p.id),
        this.rng,
      ),
      phases: phases(this.rng),
    };
    this.state.phase = 'ACTION_SELECTION';
    this.state.current = null;
    this.state.target = null;
    this.state.wheel = null;
    this.state.motions = [];
    this.state.phaseStartedAt = now;
    this.state.phaseEndsAt = now + this.state.settings.selectionSeconds * 1000;
    for (const p of this.state.players) {
      p.program = [];
      p.ready = false;
      p.reshuffleUntil =
        p.deck.hand.length >= this.state.round.phases.length ? now + BALANCE.reshuffleMs : 0;
      draw(p.deck, Math.max(0, this.state.round.phases.length + 1 - p.deck.hand.length), this.rng);
    }
    this.event('round.prepared', `Round ${this.state.round.number} · Plan your getaway`);
    this.selectionTimer = this.later(
      () => this.beginMovie(),
      this.state.settings.selectionSeconds * 1000,
    );
  }
  beginMovie() {
    if (this.state.phase !== 'ACTION_SELECTION') return;
    if (this.selectionTimer) {
      clearTimeout(this.selectionTimer);
      this.timers.delete(this.selectionTimer);
    }
    const slots = this.state.round.phases.reduce((n, f) => n + f.repeatCount, 0);
    for (const p of this.state.players) autoFill(p, slots, this.rng);
    this.state.phase = 'ACTION_MOVIE';
    this.state.phaseEndsAt = 0;
    this.event('action_movie.started', 'Plans locked. Let the chaos begin.');
    void this.movie(this.generation).catch((e) => {
      console.error('Movie failed', e);
      this.event('error', 'The movie encountered an internal error; check server logs.');
    });
  }
  private async movie(generation: number) {
    for (const step of movieOrder(this.state.round)) {
      if (generation !== this.generation) return;
      this.state.current = step;
      if (step.playerId === 'sheriff') await this.sheriff();
      else {
        const p = this.state.players.find((p) => p.id === step.playerId)!;
        const action = p.program[step.slot];
        this.event('action.started', `${p.name} · ${LABELS[action.type]}`, p.id);
        await this.resolve(p, action);
        if (action.card) p.deck.discard.push(action.card);
      }
      this.broadcast();
    }
    this.event('round.completed', `Round ${this.state.round.number} complete`);
    await this.wait(TIMING.round);
    if (generation === this.generation) this.prepareRound();
  }
  private async motion(actorId: string, path: LogicalSquare[], kind = 'move') {
    if (path.length < 2) {
      await this.wait(TIMING.action);
      return;
    }
    const duration = TIMING.movement * this.speed;
    this.state.motions = this.state.motions.filter((m) => Date.now() < m.startedAt + m.duration);
    this.state.motions.push({
      id: randomUUID(),
      actorId,
      points: path.map(({ x, y }) => ({ x, y })),
      startedAt: Date.now(),
      duration,
      kind,
    });
    if (actorId === 'sheriff') this.state.sheriffSquareId = path.at(-1)!.id;
    else this.state.players.find((p) => p.id === actorId)!.squareId = path.at(-1)!.id;
    this.broadcast(actorId === 'sheriff' ? 'game.sheriff.moved' : 'game.player.moved');
    await this.wait(TIMING.movement);
  }
  private async arrest() {
    const origins = new Map(this.state.players.map((p) => [p.id, p.squareId]));
    const caught = arrests(this.state, this.rng);
    if (!caught.length) return;
    for (const p of caught) {
      const origin = origins.get(p.id)!;
      const path = route(origin, p.squareId);
      this.state.motions.push({
        id: randomUUID(),
        actorId: p.id,
        points: path.map(({ x, y }) => ({ x, y })),
        startedAt: Date.now(),
        duration: TIMING.movement * this.speed,
        kind: 'arrest',
      });
    }
    this.event(
      'player.arrested',
      `${caught.map((p) => p.name).join(', ')} arrested · loot scattered · +1 arrest record`,
      caught[0].id,
    );
    await this.wait(TIMING.movement);
  }
  private async travel(p: PlayerState, path: LogicalSquare[], kind = 'move') {
    // Stop at first entry into the Sheriff's room, including a crossed corridor.
    const sheriffRoom = squareById[this.state.sheriffSquareId].roomId;
    const caughtAt = path.findIndex(
      (s) => s.roomId === sheriffRoom && !roomById[s.roomId].isHoldingRoom,
    );
    await this.motion(p.id, caughtAt >= 0 ? path.slice(0, caughtAt + 1) : path, kind);
    await this.arrest();
  }
  private async sheriff() {
    const room = roomById[squareById[this.state.sheriffSquareId].roomId];
    const next = choose(room.connectedRoomIds, this.rng);
    this.event('action.started', `Sheriff heads to ${roomById[next].name}`, 'sheriff');
    await this.motion('sheriff', route(this.state.sheriffSquareId, center(next).id));
    await this.arrest();
  }
  private async wheel<T extends { id: string }>(
    title: string,
    items: T[],
    label: (item: T) => string,
  ) {
    const winner = choose(items, this.rng);
    if (items.length > 1) {
      this.state.wheel = {
        id: randomUUID(),
        title,
        entries: items.map((item) => ({ id: item.id, label: label(item) })),
        winnerId: winner.id,
        endsAt: Date.now() + TIMING.wheel * this.speed,
      };
      this.broadcast('game.wheel.started');
      await this.wait(TIMING.wheel);
      this.state.wheel = null;
      this.broadcast('game.wheel.resolved');
    }
    return winner;
  }
  private async target(p: PlayerState, candidates: PlayerState[]) {
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];
    let timedOut = false;
    const targetId = await new Promise<string>((resolve) => {
      let done = false;
      const finish = (id: string) => {
        if (done) return;
        done = true;
        this.targetResolve = null;
        this.state.target = null;
        resolve(id);
      };
      this.targetResolve = finish;
      this.state.target = {
        playerId: p.id,
        candidates: candidates.map((c) => c.id),
        endsAt: Date.now() + this.state.settings.targetSeconds * 1000,
      };
      this.broadcast('game.target.requested');
      this.later(() => {
        if (done) return;
        timedOut = true;
        finish('');
      }, this.state.settings.targetSeconds * 1000);
    });
    const chosen = timedOut
      ? await this.wheel(`${p.name}'s target`, candidates, (p) => p.name)
      : candidates.find((c) => c.id === targetId)!;
    this.broadcast('game.target.resolved');
    return chosen;
  }
  async resolve(p: PlayerState, action: ProgrammedAction) {
    await resolveAction(
      {
        state: this.state,
        rng: this.rng,
        event: this.event.bind(this),
        wait: this.wait.bind(this),
        motion: this.motion.bind(this),
        travel: this.travel.bind(this),
        arrest: this.arrest.bind(this),
        target: this.target.bind(this),
        wheel: this.wheel.bind(this),
      },
      p,
      action,
    );
  }
}
