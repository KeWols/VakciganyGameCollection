import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOOT } from '../../../packages/shared/config';
import { center } from '../../../packages/shared/map';
import type { CardKind, PlayerState } from '../../../packages/shared/types';
import { Engine, type EngineEvent } from './engine';
import { makeCard } from './rules';
const engines: Engine[] = [];
function setup(count = 1) {
  const events: EngineEvent[] = [];
  const engine = new Engine(
    (e) => events.push(e),
    'test',
    () => 0.6,
    0.01,
  );
  engines.push(engine);
  engine.sessions.set('host', { role: 'host' });
  const commands = (id: string, type: string, payload: unknown = {}) =>
    engine.command({ connectionId: id, type, payload });
  return { engine, events, commands, count };
}
async function joined(count = 1) {
  const ctx = setup(count);
  for (let i = 0; i < count; i++) {
    await ctx.commands(`c${i}`, 'game.connection.hello', { role: 'player' });
    await ctx.commands(`c${i}`, 'game.player.join', {
      name: `Player ${i}`,
      avatar: '🦊',
    });
  }
  return ctx;
}
function hand(p: PlayerState, types: CardKind[]) {
  p.deck = { draw: [], hand: types.map(makeCard), discard: [] };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  engines.forEach((e) => e.dispose());
  engines.length = 0;
  vi.useRealTimers();
});
describe('authoritative command lifecycle', () => {
  it('assigns twenty unique colors, limits the crew and keeps session tokens private', async () => {
    const { engine, events, commands } = await joined(20);
    expect(new Set(engine.state.players.map((p) => p.color)).size).toBe(20);
    await commands('extra', 'game.connection.hello', { role: 'player' });
    await commands('extra', 'game.player.join', {
      name: 'Extra',
      avatar: '🦊',
    });
    expect(engine.state.players).toHaveLength(20);
    expect(events.at(-1)?.envelope.type).toBe('game.error');
    const snapshot = engine.snapshot('host');
    expect(JSON.stringify(snapshot)).not.toContain('"token"');
    expect(snapshot.me).toBeNull();
    expect('deck' in snapshot.state.players[0]).toBe(false);
  });
  it('restores all private state with the reconnect token', async () => {
    const { engine, commands } = await joined();
    const p = engine.state.players[0];
    await commands('host', 'game.host.start');
    const before = engine.snapshot('c0').me;
    await commands('c0', 'game.connection.closed');
    expect(p.connected).toBe(false);
    await commands('new', 'game.connection.hello', {
      role: 'player',
      token: p.token,
    });
    expect(p.connected).toBe(true);
    expect(engine.snapshot('new').me).toEqual(before);
    expect(engine.snapshot('new').playerId).toBe(p.id);
  });
  it('draws immediately on Skip, locks it, and allows the drawn card in a later slot', async () => {
    const { engine, commands, events } = await joined();
    await commands('host', 'game.host.start');
    const p = engine.state.players[0];
    hand(p, []);
    p.deck.draw = [makeCard('SHOOT')];
    await commands('c0', 'game.action.skip_draw', { slot: 0, skip: true });
    expect(p.program[0].type).toBe('SKIP');
    expect(p.deck.hand).toHaveLength(1);
    await commands('c0', 'game.action.program', {
      slot: 0,
      cardId: p.deck.hand[0].id,
    });
    expect(events.at(-1)?.envelope.type).toBe('game.error');
    expect(p.program[0].type).toBe('SKIP');
    await commands('c0', 'game.action.program', {
      slot: 1,
      cardId: p.deck.hand[0].id,
    });
    expect(p.program[1].type).toBe('SHOOT');
    expect(p.deck.hand).toHaveLength(0);
  });
  it('allows Skip draw beyond seven cards and never adds a Skip card to the pool', async () => {
    const { engine, commands } = await joined();
    await commands('host', 'game.host.start');
    const p = engine.state.players[0];
    hand(p, Array(7).fill('HIT_JUNK'));
    p.deck.draw = [makeCard('SHOOT')];
    await commands('c0', 'game.action.skip_draw', { slot: 0, skip: true });
    expect(p.deck.hand).toHaveLength(8);
    expect(p.program[0].card).toBeUndefined();
  });
  it('rejects foreign cards, duplicate cards, invalid ranges and nonadjacent rooms without losing cards', async () => {
    const { engine, commands, events } = await joined(2);
    await commands('host', 'game.host.start');
    const p = engine.state.players[0];
    hand(p, ['MOVE', 'GO_OTHER_ROOM']);
    const move = p.deck.hand[0],
      room = p.deck.hand[1];
    for (const payload of [
      { slot: 1, cardId: move.id },
      { slot: 0, cardId: 'foreign' },
      { slot: 0, cardId: move.id, direction: 'UP', distance: 13 },
      { slot: 0, cardId: room.id, destinationRoomId: 'holding-east' },
    ]) {
      p.squareId = '1,1';
      await commands('c0', 'game.action.program', payload);
      expect(events.at(-1)?.envelope.type).toBe('game.error');
      expect(p.program).toHaveLength(0);
      expect(p.deck.hand).toHaveLength(2);
    }
    await commands('c0', 'game.action.program', {
      slot: 0,
      cardId: move.id,
      direction: 'UP',
      distance: 2,
    });
    await commands('c0', 'game.action.program', {
      slot: 1,
      cardId: move.id,
      direction: 'UP',
      distance: 2,
    });
    expect(events.at(-1)?.envelope.type).toBe('game.error');
    expect(p.program).toHaveLength(1);
  });
  it('edits ordinary programmed cards, returns the previous card, and locks on ready', async () => {
    const { engine, commands, events } = await joined(2);
    await commands('host', 'game.host.start');
    const p = engine.state.players[0];
    hand(p, ['SHOOT', 'PUNCH']);
    const [shot, punch] = p.deck.hand;
    await commands('c0', 'game.action.program', { slot: 0, cardId: shot.id });
    await commands('c0', 'game.action.program', { slot: 0, cardId: punch.id });
    expect(p.program[0].type).toBe('PUNCH');
    expect(p.deck.hand.map((c) => c.id)).toEqual([shot.id]);
    for (let i = 1; i < 5; i++)
      await commands('c0', 'game.action.skip_draw', { slot: i, skip: true });
    await commands('c0', 'game.player.ready');
    expect(p.ready).toBe(true);
    await commands('c0', 'game.action.program', { slot: 0, cardId: shot.id });
    expect(events.at(-1)?.envelope.type).toBe('game.error');
  });
  it('rejects Ready until every slot is filled and prevents player host commands', async () => {
    const { engine, commands, events } = await joined();
    await commands('c0', 'game.host.start');
    expect(engine.state.phase).toBe('LOBBY');
    expect(events.at(-1)?.envelope.type).toBe('game.error');
    await commands('host', 'game.host.start');
    await commands('c0', 'game.player.ready');
    expect(engine.state.players[0].ready).toBe(false);
  });
  it('server timeout auto-fills disconnected players and starts the movie', async () => {
    const { engine, commands } = await joined();
    engine.state.settings.selectionSeconds = 10;
    await commands('host', 'game.host.start');
    await commands('c0', 'game.connection.closed');
    await vi.advanceTimersByTimeAsync(10000);
    expect(engine.state.phase).toBe('ACTION_MOVIE');
    expect(engine.state.players[0].program).toHaveLength(5);
    expect(engine.state.players[0].ready).toBe(true);
  });
  it('expires the three-second reshuffle offer and conserves the card pool', async () => {
    const { engine, commands, events } = await joined();
    engine.state.round.number = 1;
    const p = engine.state.players[0];
    hand(p, Array(6).fill('HIT_JUNK'));
    p.deck.draw = [makeCard('SHOOT')];
    engine.prepareRound();
    expect(p.reshuffleUntil).toBe(Date.now() + 3000);
    await commands('c0', 'game.player.reshuffle');
    expect(p.deck.hand.length + p.deck.draw.length + p.deck.discard.length).toBe(7);
    expect(p.junk).toBe(0);
    await commands('c0', 'game.player.reshuffle');
    expect(events.at(-1)?.envelope.type).toBe('game.error');
  });
  it('ends after the configured number of rounds and retains unused hand cards', async () => {
    const { engine, commands } = await joined();
    engine.state.settings.rounds = 1;
    await commands('host', 'game.host.start');
    const p = engine.state.players[0];
    hand(p, ['HIT_JUNK']);
    for (let i = 0; i < 5; i++)
      await commands('c0', 'game.action.skip_draw', { slot: i, skip: true });
    await commands('c0', 'game.player.ready');
    await vi.runAllTimersAsync();
    expect(engine.state.phase).toBe('RESULTS');
    expect(engine.state.round.number).toBe(1);
    expect(p.deck.hand[0].type).toBe('HIT_JUNK');
  });
});
describe('action resolution, targets, loot and arrests', () => {
  it('a stale room choice in Holding uses its one exit without a wheel', async () => {
    const { engine, events } = await joined();
    const p = engine.state.players[0];
    p.squareId = center('holding').id;
    engine.state.sheriffSquareId = center('room-10').id;
    const resolving = engine.resolve(p, { type: 'GO_OTHER_ROOM', destinationRoomId: 'room-5' });
    await vi.runAllTimersAsync();
    await resolving;
    expect(p.squareId).toBe(center('room-0').id);
    expect(events.some((e) => e.envelope.type === 'game.wheel.started')).toBe(false);
  });
  it.each(['holding', 'holding-east'])(
    'the Sheriff cannot punish players in %s',
    async (holding) => {
      const { engine } = await joined(2);
      const [a, b] = engine.state.players;
      a.squareId = b.squareId = engine.state.sheriffSquareId = center(holding).id;
      a.loot = [{ id: 'kept', kind: 5, squareId: a.squareId }];
      const resolving = engine.resolve(a, { type: 'MOVE', direction: 'UP', distance: 1 });
      await vi.runAllTimersAsync();
      await resolving;
      expect(a.arrests + b.arrests).toBe(0);
      expect(a.junk + b.junk).toBe(0);
      expect(a.loot).toHaveLength(1);
    },
  );
  it('successful shot increments stats and inserts Hit Junk in the victim deck', async () => {
    const { engine } = await joined(2);
    const [a, b] = engine.state.players;
    a.squareId = '0,1';
    b.squareId = '1,1';
    const resolving = engine.resolve(a, { type: 'SHOOT' });
    await vi.runAllTimersAsync();
    await resolving;
    expect(a.shots).toBe(1);
    expect(a.hitsDealt).toBe(1);
    expect(b.hitsReceived).toBe(1);
    expect(b.deck.draw.some((c) => c.type === 'HIT_JUNK')).toBe(true);
  });
  it('zero-target shooting animates without a hit', async () => {
    const { engine } = await joined();
    const p = engine.state.players[0];
    p.squareId = '0,1';
    const resolving = engine.resolve(p, { type: 'SHOOT' });
    await vi.runAllTimersAsync();
    await resolving;
    expect(engine.state.effect?.kind).toBe('shot.fired');
    expect(p.hitsDealt).toBe(0);
  });
  it('target timeout uses a server-selected wheel containing only real valid targets', async () => {
    const { engine, events, commands } = await joined(3);
    const [a, b, c] = engine.state.players;
    a.squareId = '1,1';
    b.squareId = '0,1';
    c.squareId = '1,0';
    engine.state.settings.targetSeconds = 3;
    const resolving = engine.resolve(a, { type: 'SHOOT' });
    expect(engine.state.target?.candidates).toEqual([b.id, c.id]);
    expect(engine.snapshot('c1').me?.target).toBeNull();
    await commands('c1', 'game.target.select', { targetId: b.id });
    expect(events.at(-1)?.envelope.type).toBe('game.error');
    await vi.advanceTimersByTimeAsync(3000);
    expect(engine.state.wheel?.entries.map((e) => e.id)).toEqual([b.id, c.id]);
    expect(engine.state.wheel?.winnerId).toBe(c.id);
    await vi.runAllTimersAsync();
    await resolving;
    expect(c.hitsReceived).toBe(1);
    expect(b.hitsReceived).toBe(0);
  });
  it('valid target selection resumes immediately and cannot be changed', async () => {
    const { engine, commands } = await joined(3);
    const [a, b, c] = engine.state.players;
    a.squareId = '1,1';
    b.squareId = '0,1';
    c.squareId = '1,0';
    const resolving = engine.resolve(a, { type: 'SHOOT' });
    await commands('c0', 'game.target.select', { targetId: b.id });
    await commands('c0', 'game.target.select', { targetId: c.id });
    await vi.runAllTimersAsync();
    await resolving;
    expect(b.hitsReceived).toBe(1);
    expect(c.hitsReceived).toBe(0);
    expect(engine.state.target).toBeNull();
  });
  it('steals only from the current square and preserves total loot value', async () => {
    const { engine } = await joined();
    const p = engine.state.players[0];
    p.squareId = '1,1';
    engine.state.loot = [
      { id: 'gold', kind: 3, squareId: '1,1' },
      { id: 'diamond', kind: 5, squareId: '1,1' },
      { id: 'elsewhere', kind: 2, squareId: '0,0' },
    ];
    const resolving = engine.resolve(p, { type: 'STEAL_LOOT' });
    expect(engine.state.wheel?.entries).toHaveLength(2);
    await vi.runAllTimersAsync();
    await resolving;
    expect(p.loot.map((l) => l.id)).toEqual(['diamond']);
    expect(engine.state.loot.map((l) => l.id)).toEqual(['gold', 'elsewhere']);
    expect([...p.loot, ...engine.state.loot].reduce((sum, l) => sum + LOOT[l.kind].value, 0)).toBe(
      6500,
    );
  });
  it('stealing an empty square still emits an action effect', async () => {
    const { engine } = await joined();
    const p = engine.state.players[0];
    p.squareId = '1,1';
    const resolving = engine.resolve(p, { type: 'STEAL_LOOT' });
    await vi.runAllTimersAsync();
    await resolving;
    expect(p.loot).toHaveLength(0);
    expect(engine.state.effect?.kind).toBe('loot.missed');
  });
  it('punch drops exactly one random carried item at the final knockback square', async () => {
    const { engine } = await joined(2);
    const [a, b] = engine.state.players;
    a.squareId = b.squareId = '1,1';
    b.loot = [
      { id: 'one', kind: 0, squareId: '1,1' },
      { id: 'two', kind: 1, squareId: '1,1' },
    ];
    const resolving = engine.resolve(a, { type: 'PUNCH' });
    await vi.runAllTimersAsync();
    await resolving;
    expect(b.squareId).not.toBe('1,1');
    expect(b.loot).toHaveLength(1);
    expect(engine.state.loot).toHaveLength(1);
    expect(engine.state.loot[0].squareId).toBe(b.squareId);
    expect(b.junk).toBe(0);
    expect(engine.state.motions[0].kind).toBe('punch');
  });
  it('does not show a loot wheel for a punch victim carrying no loot', async () => {
    const { engine, events } = await joined(2);
    const [a, b] = engine.state.players;
    a.squareId = b.squareId = '1,1';
    const resolving = engine.resolve(a, { type: 'PUNCH' });
    await vi.runAllTimersAsync();
    await resolving;
    expect(events.some((e) => e.envelope.type === 'game.wheel.started')).toBe(false);
  });
  it('entering the Sheriff room stops travel and arrests the entrant', async () => {
    const { engine } = await joined();
    const p = engine.state.players[0];
    p.squareId = '2,1';
    engine.state.sheriffSquareId = '5,1';
    const resolving = engine.resolve(p, {
      type: 'MOVE',
      direction: 'RIGHT',
      distance: 10,
    });
    await vi.runAllTimersAsync();
    await resolving;
    expect(p.squareId).toBe(center('holding-east').id);
    expect(p.arrests).toBe(1);
    expect(p.deck.draw.some((c) => c.type === 'SHERIFF_JUNK')).toBe(true);
  });
  it('failed cards are discarded during the movie, not lost', async () => {
    const { engine, commands } = await joined();
    engine.state.settings.rounds = 1;
    await commands('host', 'game.host.start');
    const p = engine.state.players[0];
    hand(p, ['SHOOT']);
    const card = p.deck.hand[0];
    await commands('c0', 'game.action.program', { slot: 0, cardId: card.id });
    for (let i = 1; i < 5; i++)
      await commands('c0', 'game.action.skip_draw', { slot: i, skip: true });
    await commands('c0', 'game.player.ready');
    await vi.runAllTimersAsync();
    expect(p.deck.discard.map((c) => c.id)).toContain(card.id);
  });
  it('stale Go Other Room chooses an actual adjacent exit with a wheel', async () => {
    const { engine } = await joined();
    const p = engine.state.players[0];
    p.squareId = '1,1';
    const resolving = engine.resolve(p, {
      type: 'GO_OTHER_ROOM',
      destinationRoomId: 'room-11',
    });
    await vi.runAllTimersAsync();
    await resolving;
    expect(p.squareId).toBe('1,5');
    expect(engine.state.effect?.kind).toBe('action.rerouted');
  });
});

describe('lobby management and predicted validation', () => {
  it('changes profile between heists, preserves identity, and rejects in-game edits', async () => {
    const { engine, commands, events } = await joined();
    const p = engine.state.players[0],
      { id, color, token } = p;
    await commands('c0', 'game.player.profile.update', { name: 'New alias', avatar: '🐼' });
    expect(p).toMatchObject({ id, color, token, name: 'New alias', avatar: '🐼' });
    await commands('host', 'game.host.start');
    await commands('c0', 'game.player.profile.update', { name: 'Not allowed' });
    expect(events.at(-1)?.envelope.type).toBe('game.error');
    expect(p.name).toBe('New alias');
    engine.state.phase = 'RESULTS';
    await commands('c0', 'game.player.profile.update', { name: 'Next heist' });
    expect(p.name).toBe('Next heist');
    expect(p.avatar).toBe('🐼');
  });
  it('versions the portrait URL when the picture changes', async () => {
    const { engine, commands } = await joined();
    await commands('c0', 'game.player.profile.update', {
      name: 'Photo',
      avatar: 'data:image/png;base64,AAAA',
    });
    const old = engine.snapshot('host').state.players[0].avatar;
    await commands('c0', 'game.player.profile.update', {
      name: 'Photo',
      avatar: 'data:image/png;base64,BBBB',
    });
    expect(engine.snapshot('host').state.players[0].avatar).not.toBe(old);
  });
  it('host-only kick revokes all sessions and safely reuses the released color', async () => {
    const { engine, commands, events } = await joined(3);
    const p = engine.state.players[1];
    await commands('c0', 'game.host.player.kick', { playerId: p.id });
    expect(engine.state.players).toHaveLength(3);
    await commands('duplicate', 'game.connection.hello', { role: 'player', token: p.token });
    await commands('host', 'game.host.player.kick', { playerId: p.id });
    expect(engine.state.players).toHaveLength(2);
    expect(engine.snapshot('c1').me).toBeNull();
    expect(engine.snapshot('duplicate').me).toBeNull();
    expect(events.filter((e) => e.envelope.type === 'game.player.kicked')).toHaveLength(2);
    await commands('again', 'game.connection.hello', { role: 'player', token: p.token });
    expect(engine.snapshot('again').playerId).toBeNull();
    await commands('again', 'game.player.join', { name: 'Replacement', avatar: '🐼' });
    expect(engine.state.players.at(-1)?.color).toBe(p.color);
    expect(new Set(engine.state.players.map((p) => p.color)).size).toBe(3);
  });
  it('rejects kicks once the heist starts', async () => {
    const { engine, commands, events } = await joined();
    await commands('host', 'game.host.start');
    await commands('host', 'game.host.player.kick', { playerId: engine.state.players[0].id });
    expect(events.at(-1)?.envelope.type).toBe('game.error');
    expect(engine.state.players).toHaveLength(1);
  });
  it('validates room choices from prior Move predictions and recomputes edits', async () => {
    const { engine, commands } = await joined();
    await commands('host', 'game.host.start');
    const p = engine.state.players[0];
    p.squareId = '9,5';
    hand(p, ['MOVE', 'GO_OTHER_ROOM']);
    const [move, go] = p.deck.hand;
    await commands('c0', 'game.action.program', {
      slot: 0,
      cardId: move.id,
      direction: 'LEFT',
      distance: 4,
    });
    await commands('c0', 'game.action.program', {
      slot: 1,
      cardId: go.id,
      destinationRoomId: 'room-1',
    });
    expect(p.program).toHaveLength(2);
    expect(p.program.map((a) => a.predictNextMove)).toEqual(['5,5', '5,1']);
    expect(p.squareId).toBe('9,5');
    await commands('c0', 'game.action.program', {
      slot: 0,
      cardId: move.id,
      direction: 'DOWN',
      distance: 1,
    });
    expect(p.program[1].predictNextMove).toBe('9,6');
  });
  it('rejects client-provided predicted positions', async () => {
    const { engine, commands, events } = await joined();
    await commands('host', 'game.host.start');
    const p = engine.state.players[0];
    hand(p, ['MOVE']);
    await commands('c0', 'game.action.program', {
      slot: 0,
      cardId: p.deck.hand[0].id,
      direction: 'UP',
      distance: 1,
      predictNextMove: '13,9',
    });
    expect(events.at(-1)?.envelope.type).toBe('game.error');
    expect(p.program).toHaveLength(0);
  });
});
