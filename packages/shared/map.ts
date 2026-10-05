export interface Point {
  x: number;
  y: number;
}
export interface LogicalSquare extends Point {
  id: string;
  roomId: string;
  walkable: boolean;
}
export interface Wall {
  a: Point;
  b: Point;
}
export interface Door {
  roomId: string;
  from: string;
  to: string;
  path: string[];
}
export interface RoomDefinition {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  logicalSquares: LogicalSquare[];
  connectedRoomIds: string[];
  doors: Door[];
  isTreasureRoom: boolean;
  isHoldingRoom: boolean;
}
const names = [
  'Entrance Lobby',
  'Teller Hall',
  'Customer Lounge',
  'Manager Office',
  'Records Room',
  'Staff Room',
  'Cash Counting',
  'Safe Deposit',
  'Maintenance',
  'Back Office',
  'Security Office',
  'Main Vault',
];
export const ROOMS: RoomDefinition[] = [...names, 'West Holding', 'East Holding'].map((name, i) => {
  const x = i === 12 ? -4 : i === 13 ? 16 : (i % 4) * 4,
    y = i === 12 ? 0 : i === 13 ? 8 : Math.floor(i / 4) * 4;
  const id = i === 12 ? 'holding' : i === 13 ? 'holding-east' : `room-${i}`;
  return {
    id,
    name,
    x,
    y,
    width: 3,
    height: 3,
    logicalSquares: Array.from({ length: 9 }, (_, n) => ({
      id: `${x + (n % 3)},${y + Math.floor(n / 3)}`,
      x: x + (n % 3),
      y: y + Math.floor(n / 3),
      roomId: id,
      walkable: true,
    })),
    connectedRoomIds: [],
    doors: [],
    isTreasureRoom: i === 11,
    isHoldingRoom: i >= 12,
  };
});
export const SQUARES: LogicalSquare[] = ROOMS.flatMap((r) => r.logicalSquares);
export const WALLS: Wall[] = [];
const links: [number, number][] = [];
for (let i = 0; i < 12; i++) {
  if (i % 4 < 3) links.push([i, i + 1]);
  if (i < 8) links.push([i, i + 4]);
}
links.push([12, 0], [11, 13]);
for (const [ai, bi] of links) {
  const a = ROOMS[ai],
    b = ROOMS[bi];
  const horizontal = a.y === b.y;
  const from = horizontal ? `${a.x + 2},${a.y + 1}` : `${a.x + 1},${a.y + 2}`;
  const to = horizontal ? `${b.x},${b.y + 1}` : `${b.x + 1},${b.y}`;
  const x = horizontal ? a.x + 3 : a.x + 1,
    y = horizontal ? a.y + 1 : a.y + 3;
  const corridor = { id: `${x},${y}`, x, y, roomId: a.id, walkable: true };
  SQUARES.push(corridor);
  a.connectedRoomIds.push(b.id);
  b.connectedRoomIds.push(a.id);
  a.doors.push({ roomId: b.id, from, to, path: [from, corridor.id, to] });
  b.doors.push({
    roomId: a.id,
    from: to,
    to: from,
    path: [to, corridor.id, from],
  });
}
export const squareById = Object.fromEntries(SQUARES.map((s) => [s.id, s]));
export const roomById = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
// Walls are the union boundary of walkable cells. Door/corridor cells remove wall segments.
for (const s of SQUARES) {
  for (const [dx, dy] of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]) {
    if (!squareById[`${s.x + dx},${s.y + dy}`]) {
      const x = s.x + dx * 0.5,
        y = s.y + dy * 0.5;
      WALLS.push({
        a: { x: x + dy * 0.5, y: y + dx * 0.5 },
        b: { x: x - dy * 0.5, y: y - dx * 0.5 },
      });
    }
  }
}
export function center(roomId: string) {
  return roomById[roomId].logicalSquares[4];
}
export function isHoldingSquare(squareId: string) {
  return Boolean(roomById[squareById[squareId]?.roomId]?.isHoldingRoom);
}
/** Distance is the shortest traversable route, never a straight line through walls. */
export function farthestHoldingRooms(sheriffSquareId: string) {
  const holdings = ROOMS.filter((r) => r.isHoldingRoom);
  const distances = holdings.map((r) => route(sheriffSquareId, center(r.id).id).length - 1);
  const farthest = Math.max(...distances);
  return holdings.filter((_, i) => distances[i] === farthest);
}
export function distance(a: Point, b: Point) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
export function intersects(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const ab1 = cross(a, b, c),
    ab2 = cross(a, b, d),
    cd1 = cross(c, d, a),
    cd2 = cross(c, d, b);
  return (
    ab1 * ab2 <= 0 &&
    cd1 * cd2 <= 0 &&
    Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
    Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
    Math.max(a.y, b.y) >= Math.min(c.y, d.y) &&
    Math.max(c.y, d.y) >= Math.min(a.y, b.y)
  );
}
export function clearLine(a: Point, b: Point) {
  return !WALLS.some((w) => intersects(a, b, w.a, w.b));
}
export function walk(startId: string, dx: number, dy: number, steps: number) {
  const path = [squareById[startId]];
  for (let i = 0; i < steps; i++) {
    const a = path.at(-1)!;
    const b = squareById[`${a.x + dx},${a.y + dy}`];
    if (!b || !clearLine(a, b)) break;
    path.push(b);
  }
  return path;
}
export function route(fromId: string, toId: string) {
  const queue = [fromId],
    previous = new Map<string, string | null>([[fromId, null]]);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === toId) break;
    const s = squareById[id];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = `${s.x + dx},${s.y + dy}`;
      if (squareById[next] && !previous.has(next) && clearLine(s, squareById[next])) {
        previous.set(next, id);
        queue.push(next);
      }
    }
  }
  if (!previous.has(toId)) return [squareById[fromId]];
  const ids = [];
  let id: string | null = toId;
  while (id) {
    ids.unshift(id);
    id = previous.get(id)!;
  }
  return ids.map((x) => squareById[x]);
}
// Balanced rows partition the square into exactly N equal-area rectangles.
export function subgrid(n: number) {
  if (n < 1) return [];
  const rows = Math.max(1, Math.round(Math.sqrt(n)));
  let used = 0;
  const points: Point[] = [];
  for (let r = 0; r < rows; r++) {
    const count = Math.floor(n / rows) + (r < n % rows ? 1 : 0),
      height = count / n;
    for (let c = 0; c < count; c++)
      points.push({
        x: (c + 0.5) / count - 0.5,
        y: used / n + height / 2 - 0.5,
      });
    used += count;
  }
  return points;
}
