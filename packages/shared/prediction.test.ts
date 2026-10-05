import { describe, expect, it } from 'vitest';
import { center, farthestHoldingRooms, ROOMS, route, squareById } from './map';
import { predictProgram, predictedOrigin, refreshPredictions } from './prediction';
import type { ProgrammedAction } from './types';
describe('chained planning estimates', () => {
  it('offers the next room from Staff after moving out of Cash Counting', () => {
    const plan: ProgrammedAction[] = [
      { type: 'MOVE', direction: 'LEFT', distance: 4 },
      { type: 'GO_OTHER_ROOM', destinationRoomId: 'room-1' },
    ];
    const steps = predictProgram('9,5', plan);
    expect(steps[0].predictNextMove).toBe('5,5');
    expect(steps[1].from).toBe('5,5');
    expect(steps[1].predictNextMove).toBe('5,1');
    expect(steps.every((s) => !s.uncertain)).toBe(true);
  });
  it('chains later moves from the predicted square', () => {
    const plan: ProgrammedAction[] = [
      { type: 'MOVE', direction: 'LEFT', distance: 4 },
      { type: 'SKIP' },
      { type: 'MOVE', direction: 'UP', distance: 4 },
    ];
    expect(predictedOrigin('9,5', plan, 2)).toBe('5,5');
    refreshPredictions('9,5', plan);
    expect(plan.map((a) => a.predictNextMove)).toEqual(['5,5', '5,5', '5,1']);
  });
  it('respects walls and recalculates downstream predictions after an edit', () => {
    const plan: ProgrammedAction[] = [
      { type: 'MOVE', direction: 'DOWN', distance: 12 },
      { type: 'MOVE', direction: 'RIGHT', distance: 1 },
    ];
    refreshPredictions('0,0', plan);
    expect(plan.map((a) => a.predictNextMove)).toEqual(['0,2', '1,2']);
    plan[0] = { type: 'MOVE', direction: 'RIGHT', distance: 12 };
    refreshPredictions('0,0', plan);
    expect(plan.map((a) => a.predictNextMove)).toEqual(['2,0', '2,0']);
  });
  it('flags uncertainty without inventing a random room on the client', () => {
    const steps = predictProgram('9,5', [
      { type: 'GO_OTHER_ROOM', destinationRoomId: 'holding' },
      { type: 'SKIP' },
    ]);
    expect(steps[0].predictNextMove).toBe('9,5');
    expect(steps.every((s) => s.uncertain)).toBe(true);
  });
  it('predicts the deterministic single exit out of either Holding', () => {
    for (const room of ROOMS.filter((r) => r.isHoldingRoom)) {
      const step = predictProgram(center(room.id).id, [
        { type: 'GO_OTHER_ROOM', destinationRoomId: 'room-5' },
      ])[0];
      expect(squareById[step.predictNextMove].roomId).toBe(room.connectedRoomIds[0]);
      expect(step.uncertain).toBe(false);
    }
  });
});
describe('farthest Holding selection', () => {
  it('chooses east for a western Sheriff, and west for an eastern Sheriff', () => {
    expect(farthestHoldingRooms(center('room-0').id).map((r) => r.id)).toEqual(['holding-east']);
    expect(farthestHoldingRooms(center('room-11').id).map((r) => r.id)).toEqual(['holding']);
  });
  it('maximizes actual walkable distance for every main-room Sheriff position', () => {
    for (const room of ROOMS.filter((r) => !r.isHoldingRoom)) {
      const origin = center(room.id).id;
      const expected = Math.max(
        ...ROOMS.filter((r) => r.isHoldingRoom).map((r) => route(origin, center(r.id).id).length),
      );
      for (const holding of farthestHoldingRooms(origin))
        expect(route(origin, center(holding.id).id).length).toBe(expected);
    }
  });
});
