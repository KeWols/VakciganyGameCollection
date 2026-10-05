import { randomInt, randomUUID } from 'node:crypto';
import {
  ACTIONS,
  BALANCE,
  DIRECTIONS,
  LOOT,
  type Direction,
} from '../../../packages/shared/config';
import {
  ROOMS,
  center,
  clearLine,
  distance,
  farthestHoldingRooms,
  isHoldingSquare,
  roomById,
  squareById,
  walk,
} from '../../../packages/shared/map';
import type {
  ActionRound,
  Card,
  CardKind,
  GameSettings,
  GameState,
  MiniActionPhase,
  MovieStep,
  PlayerDeck,
  PlayerState,
  ProgrammedAction,
} from '../../../packages/shared/types';
import { predictedOrigin, refreshPredictions } from '../../../packages/shared/prediction';
export type Random = () => number;
export const random: Random = () => randomInt(0, 0x100000000) / 0x100000000;
export function choose<T>(items: readonly T[], rng: Random = random): T {
  if (!items.length) throw new Error('Cannot choose from empty collection');
  return items[Math.floor(rng() * items.length)];
}
export function shuffle<T>(items: readonly T[], rng: Random = random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function phases(rng: Random = random): MiniActionPhase[] {
  const n = 3 + Math.floor(rng() * 4);
  let doubles = 0;
  return Array.from({ length: n }, (_, index) => {
    const double = doubles < 2 && rng() < 0.25;
    if (double) doubles++;
    return { index, repeatCount: double ? 2 : 1 };
  });
}
export function movieOrder(round: ActionRound): MovieStep[] {
  const out: MovieStep[] = [];
  let offset = 0;
  for (const phase of round.phases) {
    // Repeat INSIDE each player's turn: B1 B2 C1 C2, never B1 C1 B2 C2.
    for (const playerId of round.order)
      for (let repeat = 0; repeat < phase.repeatCount; repeat++)
        out.push({
          playerId,
          phase: phase.index,
          repeat,
          slot: offset + repeat,
        });
    for (let repeat = 0; repeat < phase.repeatCount; repeat++)
      out.push({ playerId: 'sheriff', phase: phase.index, repeat, slot: -1 });
    offset += phase.repeatCount;
  }
  return out;
}
export function makeCard(type: CardKind): Card {
  return { id: randomUUID(), type };
}
export function createDeck(settings: GameSettings, rng: Random = random): PlayerDeck {
  return {
    draw: shuffle(
      ACTIONS.flatMap((type) => Array.from({ length: settings.deck[type] }, () => makeCard(type))),
      rng,
    ),
    hand: [],
    discard: [],
  };
}
export function draw(deck: PlayerDeck, count: number, rng: Random = random) {
  for (let i = 0; i < count; i++) {
    if (!deck.draw.length) {
      deck.draw = shuffle(deck.discard, rng);
      deck.discard = [];
    }
    const card = deck.draw.pop();
    if (!card) break;
    deck.hand.push(card);
  }
}
export function junk(player: PlayerState, type: 'HIT_JUNK' | 'SHERIFF_JUNK', rng: Random = random) {
  player.deck.draw = shuffle([...player.deck.draw, makeCard(type)], rng);
  player.junk++;
}
export function usable(card: Card) {
  return ACTIONS.includes(card.type as (typeof ACTIONS)[number]);
}
export function getPlayersInRoom(players: PlayerState[], roomId: string) {
  return players.filter((p) => squareById[p.squareId]?.roomId === roomId);
}
export function getPlayersInSquare(players: PlayerState[], squareId: string) {
  return players.filter((p) => p.squareId === squareId);
}
export function minimum<T>(items: T[], count: (item: T) => number) {
  const min = Math.min(...items.map(count));
  return items.filter((x) => count(x) === min);
}
export function spawn(players: PlayerState[], rng: Random = random) {
  const rooms = ROOMS.filter((r) => !r.isTreasureRoom && !r.isHoldingRoom);
  const room = choose(
    minimum(rooms, (r) => getPlayersInRoom(players, r.id).length),
    rng,
  );
  return choose(
    minimum(room.logicalSquares, (s) => getPlayersInSquare(players, s.id).length),
    rng,
  ).id;
}
export function shootTargets(player: PlayerState, players: PlayerState[]) {
  const a = squareById[player.squareId];
  return players.filter((p) => {
    const b = squareById[p.squareId];
    if (
      p.id === player.id ||
      p.squareId === player.squareId ||
      distance(a, b) > BALANCE.shootRange ||
      !clearLine(a, b)
    )
      return false;
    return !players.some((blocker) => {
      if (blocker.id === player.id || blocker.id === p.id) return false;
      const c = squareById[blocker.squareId];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy);
      return t > 0 && t < 1 && Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx) < 1e-7;
    });
  });
}
export function punchTargets(player: PlayerState, players: PlayerState[]) {
  return players.filter((p) => p.id !== player.id && p.squareId === player.squareId);
}
export function punchDestinations(squareId: string) {
  return Object.values(DIRECTIONS).flatMap(([dx, dy]) =>
    [1, 2].flatMap((n) => {
      const path = walk(squareId, dx, dy, n);
      return path.length === n + 1 ? [path] : [];
    }),
  );
}
export function knockback(victim: PlayerState, players: PlayerState[], rng: Random = random) {
  const options = punchDestinations(victim.squareId);
  if (!options.length) return [squareById[victim.squareId]];
  const empty = options.filter((path) => !players.some((p) => p.squareId === path.at(-1)!.id));
  return choose(empty.length ? empty : options, rng);
}
export function randomAction(player: PlayerState, rng: Random = random): ProgrammedAction {
  const cards = player.deck.hand.filter(usable);
  if (!cards.length) {
    draw(player.deck, 1, rng);
    return { type: 'SKIP' };
  }
  const card = choose(cards, rng);
  player.deck.hand = player.deck.hand.filter((c) => c.id !== card.id);
  const type = card.type as ProgrammedAction['type'];
  const params =
    type === 'MOVE'
      ? {
          direction: choose(Object.keys(DIRECTIONS) as Direction[], rng),
          distance: 1 + Math.floor(rng() * 12),
        }
      : type === 'GO_OTHER_ROOM'
        ? {
            destinationRoomId: choose(
              roomById[
                squareById[predictedOrigin(player.squareId, player.program, player.program.length)]
                  .roomId
              ].connectedRoomIds,
              rng,
            ),
          }
        : {};
  return { type, card, ...params };
}
export function autoFill(player: PlayerState, slots: number, rng: Random = random) {
  while (player.program.length < slots) player.program.push(randomAction(player, rng));
  refreshPredictions(player.squareId, player.program);
  player.ready = true;
}
export function arrests(state: GameState, rng: Random = random) {
  const roomId = squareById[state.sheriffSquareId].roomId;
  if (isHoldingSquare(state.sheriffSquareId)) return [];
  const caught = getPlayersInRoom(state.players, roomId);
  for (const p of caught) {
    for (const loot of p.loot) {
      loot.squareId = choose(roomById[roomId].logicalSquares, rng).id;
      state.loot.push(loot);
    }
    p.loot = [];
    p.arrests++;
    junk(p, 'SHERIFF_JUNK', rng);
    p.squareId = center(choose(farthestHoldingRooms(state.sheriffSquareId), rng).id).id;
  }
  return caught;
}
export function lootValue(p: Pick<PlayerState, 'loot'>) {
  return p.loot.reduce((sum, l) => sum + LOOT[l.kind].value, 0);
}
export function score(p: PlayerState) {
  return (
    lootValue(p) +
    p.hitsDealt * BALANCE.successfulHitBonus -
    p.hitsReceived * BALANCE.receivedHitPenalty
  );
}
