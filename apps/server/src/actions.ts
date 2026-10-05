import { DIRECTIONS, LOOT, TIMING } from '../../../packages/shared/config';
import {
  center,
  roomById,
  route,
  squareById,
  walk,
  type LogicalSquare,
} from '../../../packages/shared/map';
import type { GameState, PlayerState, ProgrammedAction } from '../../../packages/shared/types';
import { junk, knockback, punchTargets, shootTargets, type Random } from './rules';

/** Action handlers depend on this small movie interface, not WebSockets or React. */
export interface ActionContext {
  state: GameState;
  rng: Random;
  event(kind: string, text: string, actorId?: string, targetId?: string): void;
  wait(ms: number): Promise<void>;
  motion(actorId: string, path: LogicalSquare[], kind?: string): Promise<void>;
  travel(player: PlayerState, path: LogicalSquare[], kind?: string): Promise<void>;
  arrest(): Promise<void>;
  target(player: PlayerState, candidates: PlayerState[]): Promise<PlayerState | null>;
  wheel<T extends { id: string }>(
    title: string,
    items: T[],
    label: (item: T) => string,
  ): Promise<T>;
}

type Handler = (
  context: ActionContext,
  player: PlayerState,
  action: ProgrammedAction,
) => Promise<void>;
const handlers: Record<ProgrammedAction['type'], Handler> = {
  async MOVE(ctx, p, action) {
    const [dx, dy] = DIRECTIONS[action.direction!];
    await ctx.travel(p, walk(p.squareId, dx, dy, action.distance!));
  },
  async GO_OTHER_ROOM(ctx, p, action) {
    const room = roomById[squareById[p.squareId].roomId];
    let destination = action.destinationRoomId!;
    if (!room.connectedRoomIds.includes(destination)) {
      const options = room.connectedRoomIds.map((id) => roomById[id]);
      const selected = await ctx.wheel(
        `${p.name} · new exit from ${room.name}`,
        options,
        (r) => r.name,
      );
      destination = selected.id;
      ctx.event('action.rerouted', `${p.name}'s plan changed · heading to ${selected.name}`, p.id);
    }
    await ctx.travel(p, route(p.squareId, center(destination).id));
  },
  async SHOOT(ctx, p) {
    const target = await ctx.target(p, shootTargets(p, ctx.state.players));
    if (target) {
      p.hitsDealt++;
      p.shots++;
      target.hitsReceived++;
      junk(target, 'HIT_JUNK', ctx.rng);
    }
    ctx.event(
      target ? 'shot.hit' : 'shot.fired',
      target ? `${p.name} shot ${target.name} · +1 bullet hole` : `${p.name} fired into thin air`,
      p.id,
      target?.id,
    );
    await ctx.wait(TIMING.action);
  },
  async PUNCH(ctx, p) {
    const target = await ctx.target(p, punchTargets(p, ctx.state.players));
    if (!target) {
      ctx.event('punch.missed', `${p.name} punched the air`, p.id);
      await ctx.wait(TIMING.action);
      return;
    }
    p.hitsDealt++;
    target.hitsReceived++;
    ctx.event('punch.hit', `${p.name} punched ${target.name}`, p.id, target.id);
    await ctx.motion(target.id, knockback(target, ctx.state.players, ctx.rng), 'punch');
    if (target.loot.length) {
      const item = await ctx.wheel('Dropped from the bag', target.loot, (l) => LOOT[l.kind].name);
      target.loot = target.loot.filter((l) => l.id !== item.id);
      item.squareId = target.squareId;
      ctx.state.loot.push(item);
      ctx.event('loot.dropped', `${target.name} dropped ${LOOT[item.kind].name}`, target.id);
      await ctx.wait(TIMING.action);
    }
    await ctx.arrest();
  },
  async STEAL_LOOT(ctx, p) {
    const items = ctx.state.loot.filter((l) => l.squareId === p.squareId);
    if (items.length) {
      const item = await ctx.wheel(
        'A lucky withdrawal',
        items,
        (l) => `${LOOT[l.kind].name} · $${LOOT[l.kind].value}`,
      );
      ctx.state.loot = ctx.state.loot.filter((l) => l.id !== item.id);
      p.loot.push(item);
      ctx.event('loot.picked', `${p.name} pocketed ${LOOT[item.kind].name}`, p.id);
    } else {
      ctx.event('loot.missed', `${p.name} grabbed a handful of air`, p.id);
    }
    await ctx.wait(TIMING.action);
  },
  async SKIP(ctx, p) {
    ctx.event('action.skipped', `${p.name} is lying low`, p.id);
    await ctx.wait(TIMING.action);
  },
};

export function resolveAction(
  context: ActionContext,
  player: PlayerState,
  action: ProgrammedAction,
) {
  return handlers[action.type](context, player, action);
}
