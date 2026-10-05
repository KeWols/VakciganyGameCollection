import { DIRECTIONS } from './config';
import { center, roomById, route, squareById, walk, type LogicalSquare } from './map';
import type { ProgrammedAction } from './types';

export interface PredictedStep {
  from: string;
  predictNextMove: string;
  path: LogicalSquare[];
  uncertain: boolean;
}

/** Planning only: deliberately ignores other players and future Sheriff actions.
 * Shared with the server so clients cannot invent an adjacent room or a position.
 * Unknown random fallbacks retain the estimated position and mark all later steps uncertain.
 */
export function predictProgram(
  startSquareId: string,
  program: ProgrammedAction[],
): PredictedStep[] {
  let squareId = startSquareId;
  let uncertain = false;
  return program.map((action) => {
    const from = squareId;
    let path = [squareById[from]];
    if (action.type === 'MOVE' && action.direction && action.distance) {
      const [dx, dy] = DIRECTIONS[action.direction];
      path = walk(from, dx, dy, action.distance);
    } else if (action.type === 'GO_OTHER_ROOM') {
      const adjacent = roomById[squareById[from].roomId].connectedRoomIds;
      const destination = adjacent.includes(action.destinationRoomId ?? '')
        ? action.destinationRoomId
        : adjacent.length === 1
          ? adjacent[0]
          : undefined;
      if (destination) path = route(from, center(destination).id);
      else uncertain = true;
    }
    squareId = path.at(-1)!.id;
    return { from, predictNextMove: squareId, path, uncertain };
  });
}

export function predictedOrigin(startSquareId: string, program: ProgrammedAction[], slot: number) {
  return (
    predictProgram(startSquareId, program.slice(0, slot)).at(-1)?.predictNextMove ?? startSquareId
  );
}

export function refreshPredictions(startSquareId: string, program: ProgrammedAction[]) {
  predictProgram(startSquareId, program).forEach((step, i) => {
    program[i].predictNextMove = step.predictNextMove;
  });
}
