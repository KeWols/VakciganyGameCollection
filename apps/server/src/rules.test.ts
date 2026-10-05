import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PALETTE } from '../../../packages/shared/config';
import {
  ROOMS,
  SQUARES,
  center,
  clearLine,
  distance,
  route,
  squareById,
  subgrid,
  walk,
} from '../../../packages/shared/map';
import type { GameState, PlayerState } from '../../../packages/shared/types';
import {
  arrests,
  autoFill,
  createDeck,
  draw,
  junk,
  knockback,
  lootValue,
  makeCard,
  movieOrder,
  phases,
  punchDestinations,
  punchTargets,
  score,
  shootTargets,
  shuffle,
  spawn,
} from './rules';
import { settingsSchema } from './validation';
export function player(id: string, squareId = '1,1'): PlayerState {
  return {
    id,
    token: `token-${id}`,
    name: id,
    avatar: '🦊',
    color: PALETTE[0],
    squareId,
    loot: [],
    hitsDealt: 0,
    shots: 0,
    hitsReceived: 0,
    arrests: 0,
    junk: 0,
    deck: { draw: [], hand: [], discard: [] },
    program: [],
    ready: false,
    connected: true,
    reshuffleUntil: 0,
    lastEmojiAt: 0,
  };
}
export function seeded(seed = 1234) {
  let n = seed;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
describe('rounds and strict movie order', () => {
  it('randomizes a permutation of players without mutating input', () => {
    const ids = ['A', 'B', 'C', 'D'];
    expect(shuffle(ids, () => 0)).toEqual(['B', 'C', 'D', 'A']);
    expect(ids).toEqual(['A', 'B', 'C', 'D']);
  });
  it('generates only 3–6 phases and a maximum of two doubles', () => {
    const rng = seeded();
    const lengths = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const result = phases(rng);
      lengths.add(result.length);
      expect(result.filter((f) => f.repeatCount === 2).length).toBeLessThanOrEqual(2);
    }
    expect([...lengths].sort()).toEqual([3, 4, 5, 6]);
  });
  it('uses the exact 25% threshold independently before the cap', () => {
    const values = [0, 0.249999, 0.25, 0.1];
    const result = phases(() => values.shift()!);
    expect(result.map((f) => f.repeatCount)).toEqual([2, 1, 2]);
    expect(phases(() => 0).map((f) => f.repeatCount)).toEqual([2, 2, 1]);
  });
  it('executes phases outside players, doubles inside players, then Sheriff twice', () => {
    const steps = movieOrder({
      number: 1,
      order: ['B', 'C', 'A', 'D'],
      phases: [
        { index: 0, repeatCount: 1 },
        { index: 1, repeatCount: 1 },
        { index: 2, repeatCount: 2 },
      ],
    });
    expect(steps.map((s) => `${s.playerId}${s.repeat + 1}`)).toEqual([
      'B1',
      'C1',
      'A1',
      'D1',
      'sheriff1',
      'B1',
      'C1',
      'A1',
      'D1',
      'sheriff1',
      'B1',
      'B2',
      'C1',
      'C2',
      'A1',
      'A2',
      'D1',
      'D2',
      'sheriff1',
      'sheriff2',
    ]);
    expect(steps.filter((s) => s.playerId === 'B').map((s) => s.slot)).toEqual([0, 1, 2, 3]);
  });
});
describe('bank geometry and continuous destination data', () => {
  it('defines twelve rooms plus two Holdings with exactly nine squares each', () => {
    expect(ROOMS).toHaveLength(14);
    expect(ROOMS.filter((r) => r.isHoldingRoom)).toHaveLength(2);
    expect(ROOMS.every((r) => r.logicalSquares.length === 9)).toBe(true);
    expect(new Set(SQUARES.map((s) => s.id)).size).toBe(SQUARES.length);
  });
  it('stops at the last valid square before a wall without sliding', () => {
    expect(walk('0,0', 0, 1, 5).map((s) => s.id)).toEqual(['0,0', '0,1', '0,2']);
    expect(walk('0,0', -1, -1, 12)).toHaveLength(1);
  });
  it('crosses open doors and prevents diagonal corner cuts', () => {
    expect(walk('1,1', 1, 0, 5).at(-1)?.id).toBe('6,1');
    expect(walk('2,0', 1, 1, 1)).toHaveLength(1);
  });
  it('routes room travel through walkable doorways, including Holding escape', () => {
    const path = route(center('holding').id, center('room-8').id);
    expect(path.at(-1)?.id).toBe(center('room-8').id);
    expect(path.every((p, i) => !i || clearLine(path[i - 1], p))).toBe(true);
  });
  it('creates exactly N balanced, unique subregion centers for 1–20 occupants', () => {
    for (let n = 1; n <= 20; n++) {
      const points = subgrid(n);
      expect(points).toHaveLength(n);
      expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(n);
      expect(points.every((p) => Math.abs(p.x) < 0.5 && Math.abs(p.y) < 0.5)).toBe(true);
    }
    expect(subgrid(1)).toEqual([{ x: 0, y: 0 }]);
  });
});
describe('shooting and punching', () => {
  it('uses Chebyshev range 6, including diagonals', () => {
    expect(distance({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(6);
    const a = player('A', '0,1'),
      b = player('B', '6,1'),
      c = player('C', '8,1');
    expect(shootTargets(a, [a, b, c]).map((p) => p.id)).toEqual(['B']);
  });
  it('rejects shooting another player in the same square', () => {
    const a = player('A'),
      b = player('B');
    expect(shootTargets(a, [a, b])).toEqual([]);
  });
  it('blocks shots through walls but permits aligned doors', () => {
    expect(clearLine(squareById['2,0'], squareById['4,0'])).toBe(false);
    expect(clearLine(squareById['2,1'], squareById['4,1'])).toBe(true);
    const a = player('A', '2,0'),
      b = player('B', '4,0');
    expect(shootTargets(a, [a, b])).toEqual([]);
  });
  it('a nearer player blocks shooting through them', () => {
    const a = player('A', '0,1'),
      b = player('B', '1,1'),
      c = player('C', '2,1');
    expect(shootTargets(a, [a, b, c]).map((p) => p.id)).toEqual(['B']);
  });
  it('punch targets are only same-square players', () => {
    const a = player('A'),
      b = player('B'),
      c = player('C', '1,2');
    expect(punchTargets(a, [a, b, c]).map((p) => p.id)).toEqual(['B']);
  });
  it('punch destinations have distance 1–2 and cannot cross walls', () => {
    const origin = squareById['0,0'];
    for (const path of punchDestinations(origin.id)) {
      expect(distance(origin, path.at(-1)!)).toBeLessThanOrEqual(2);
      expect(distance(origin, path.at(-1)!)).toBeGreaterThanOrEqual(1);
      expect(path.every((p, i) => !i || clearLine(path[i - 1], p))).toBe(true);
    }
  });
  it('prefers empty knockback destinations and permits occupied fallback', () => {
    const victim = player('V');
    const blockers = SQUARES.map((s, i) => player(String(i), s.id));
    const result = knockback(victim, blockers, () => 0);
    expect(result.length).toBeGreaterThan(1);
    const free = knockback(victim, [victim, player('B', '1,0')], () => 0);
    expect(free.at(-1)?.id).not.toBe('1,0');
  });
});
describe('decks, junk, timeout and spawning', () => {
  it('refills draw from shuffled discard midway through drawing', () => {
    const deck = {
      draw: [makeCard('MOVE')],
      hand: [],
      discard: [makeCard('SHOOT'), makeCard('PUNCH')],
    };
    draw(deck, 3, () => 0);
    expect(deck.hand).toHaveLength(3);
    expect(deck.discard).toHaveLength(0);
    expect(deck.draw).toHaveLength(0);
  });
  it('maintains separate eleven-card starting decks', () => {
    const a = createDeck(DEFAULT_SETTINGS),
      b = createDeck(DEFAULT_SETTINGS);
    expect(a.draw).toHaveLength(11);
    expect(a.draw.some((c) => b.draw.some((d) => d.id === c.id))).toBe(false);
  });
  it('auto-fills with usable cards and valid parameters, drawing immediately on skip', () => {
    const p = player('A');
    p.deck.hand = [makeCard('HIT_JUNK')];
    p.deck.draw = [makeCard('MOVE')];
    autoFill(p, 3, () => 0);
    expect(p.program.map((a) => a.type)).toEqual(['SKIP', 'MOVE', 'SKIP']);
    expect(p.program[1]).toMatchObject({ direction: 'UP', distance: 1 });
    expect(p.deck.hand[0].type).toBe('HIT_JUNK');
    expect(p.ready).toBe(true);
  });
  it('inserts each distinct junk type into draw pool permanently', () => {
    const p = player('A');
    junk(p, 'HIT_JUNK', () => 0);
    junk(p, 'SHERIFF_JUNK', () => 0);
    expect(p.deck.draw.map((c) => c.type).sort()).toEqual(['HIT_JUNK', 'SHERIFF_JUNK']);
    draw(p.deck, 2);
    expect(p.deck.hand).toHaveLength(2);
    expect(p.junk).toBe(2);
  });
  it('spawn excludes vault and Holding and always selects minimum occupancy', () => {
    const players: PlayerState[] = [];
    const rng = seeded();
    for (let i = 0; i < 20; i++) {
      const id = spawn(players, rng),
        room = ROOMS.find((r) => r.id === squareById[id].roomId)!;
      expect(room.isTreasureRoom || room.isHoldingRoom).toBe(false);
      const counts = ROOMS.filter((r) => !r.isTreasureRoom && !r.isHoldingRoom).map(
        (r) => players.filter((p) => squareById[p.squareId].roomId === r.id).length,
      );
      expect(players.filter((p) => squareById[p.squareId].roomId === room.id).length).toBe(
        Math.min(...counts),
      );
      players.push(player(String(i), id));
    }
    expect(new Set(players.slice(0, 11).map((p) => squareById[p.squareId].roomId)).size).toBe(11);
  });
  it('rejects settings with no usable cards and fractional counts', () => {
    expect(
      settingsSchema.safeParse({
        ...DEFAULT_SETTINGS,
        deck: { MOVE: 0, GO_OTHER_ROOM: 0, SHOOT: 0, STEAL_LOOT: 0, PUNCH: 0 },
      }).success,
    ).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, lootCount: 2.5 }).success).toBe(false);
  });
});
describe('arrest and scoring', () => {
  it('arrests every player, scatters all loot and gives each one Sheriff junk', () => {
    const players = ['A', 'B', 'C'].map((id) => player(id, '9,9'));
    players.forEach((p, i) => {
      p.loot = Array.from({ length: 12 }, (_, n) => ({
        id: `${i}-${n}`,
        kind: 0,
        squareId: p.squareId,
      }));
    });
    const state = {
      players,
      sheriffSquareId: '9,9',
      loot: [],
    } as unknown as GameState;
    const caught = arrests(state, seeded());
    expect(caught).toHaveLength(3);
    expect(state.loot).toHaveLength(36);
    expect(new Set(state.loot.map((l) => l.squareId)).size).toBeGreaterThan(1);
    expect(state.loot.every((l) => squareById[l.squareId].roomId === 'room-10')).toBe(true);
    for (const p of players) {
      expect(p.squareId).toBe(center('holding').id);
      expect(p.loot).toHaveLength(0);
      expect(p.deck.draw[0].type).toBe('SHERIFF_JUNK');
      expect(p.arrests).toBe(1);
    }
  });
  it('does not repeatedly arrest players in Holding', () => {
    const p = player('A', center('holding').id);
    const state = {
      players: [p],
      sheriffSquareId: p.squareId,
      loot: [],
    } as unknown as GameState;
    expect(arrests(state)).toHaveLength(0);
    expect(p.arrests).toBe(0);
  });
  it('centralizes loot + hit bonuses minus positive received-hit penalty', () => {
    const p = player('A');
    p.loot = [{ id: 'd', kind: 5, squareId: p.squareId }];
    p.hitsDealt = 2;
    p.hitsReceived = 1;
    expect(lootValue(p)).toBe(3000);
    expect(score(p)).toBe(2500);
  });
});
