import { useEffect, useRef, useState } from 'react';
import { LOOT } from '../../../packages/shared/config';
import {
  ROOMS,
  SQUARES,
  WALLS,
  squareById,
  subgrid,
  type Point,
} from '../../../packages/shared/map';
import type { PublicState } from '../../../packages/shared/types';
import type { Reaction } from './useGame';
const SCALE = 56,
  ox = 45,
  oy = 48;
const px = (x: number) => ox + x * SCALE,
  py = (y: number) => oy + y * SCALE;
type Pose = Point & { size: number };
function targets(state: PublicState) {
  const out: Record<string, Pose> = {};
  const groups = new Map<string, string[]>();
  for (const p of state.players) {
    if (!squareById[p.squareId]) continue;
    groups.set(p.squareId, [...(groups.get(p.squareId) ?? []), p.id]);
  }
  for (const [squareId, ids] of groups) {
    const offsets = subgrid(ids.length),
      square = squareById[squareId];
    ids.sort();
    ids.forEach((id, i) => {
      out[id] = {
        x: square.x + offsets[i].x * 0.84,
        y: square.y + offsets[i].y * 0.84,
        size: Math.min(1, 1.35 / Math.sqrt(ids.length)),
      };
    });
  }
  const s = squareById[state.sheriffSquareId];
  out.sheriff = { x: s.x, y: s.y, size: 1 };
  return out;
}
function usePoses(state: PublicState, now: number) {
  const [poses, setPoses] = useState<Record<string, Pose>>({}),
    current = useRef<Record<string, Pose>>({}),
    offset = useRef(0),
    seen = useRef(new Set<string>());
  offset.current = now - Date.now();
  const runs = useRef<
    Record<string, { points: Point[]; start: number; duration: number; from: Pose; to: Pose }>
  >({});
  useEffect(() => {
    const dest = targets(state);
    for (const [id, to] of Object.entries(dest)) {
      const from = current.current[id] ?? to;
      const motion = [...state.motions]
        .reverse()
        .find(
          (m) =>
            m.actorId === id &&
            !seen.current.has(m.id) &&
            m.startedAt + m.duration > Date.now() + offset.current,
        );
      if (motion) {
        seen.current.add(motion.id);
        runs.current[id] = {
          points: [from, ...motion.points.slice(1, -1), to],
          start: performance.now(),
          duration: Math.max(80, motion.startedAt + motion.duration - Date.now() - offset.current),
          from,
          to,
        };
      } else {
        const run = runs.current[id];
        if (!run || run.to.x !== to.x || run.to.y !== to.y || run.to.size !== to.size)
          runs.current[id] = {
            points: [from, to],
            start: performance.now(),
            duration: 450,
            from,
            to,
          };
      }
    }
    for (const id of Object.keys(runs.current)) if (!dest[id]) delete runs.current[id];
  }, [state]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const out: Record<string, Pose> = {};
      for (const [id, run] of Object.entries(runs.current)) {
        const t = Math.min(1, (performance.now() - run.start) / run.duration),
          e = t * t * (3 - 2 * t),
          lengths = run.points
            .slice(1)
            .map((p, i) => Math.hypot(p.x - run.points[i].x, p.y - run.points[i].y));
        let remaining = e * lengths.reduce((s, n) => s + n, 0),
          point = run.to;
        for (let i = 0; i < lengths.length; i++) {
          if (remaining <= lengths[i]) {
            const f = lengths[i] ? remaining / lengths[i] : 1;
            point = {
              ...run.to,
              x: run.points[i].x + (run.points[i + 1].x - run.points[i].x) * f,
              y: run.points[i].y + (run.points[i + 1].y - run.points[i].y) * f,
            };
            break;
          }
          remaining -= lengths[i];
        }
        out[id] = {
          x: point.x,
          y: point.y,
          size: run.from.size + (run.to.size - run.from.size) * e,
        };
      }
      current.current = out;
      setPoses(out);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return poses;
}
export function BankMap({
  state,
  now,
  reactions = [],
  inspect = false,
}: {
  state: PublicState;
  now: number;
  reactions?: Reaction[];
  inspect?: boolean;
}) {
  const poses = usePoses(state, now);
  const effect = state.effect && now - state.effect.at < 1000 ? state.effect : null;
  const lobby = state.phase === 'LOBBY';
  const [zoom, setZoom] = useState(1);
  const [detail, setDetail] = useState('Tap a portrait or loot item to inspect it.');
  return (
    <div className={`bank-container ${inspect ? 'inspect' : ''}`}>
      {inspect && (
        <div className="zoom-controls">
          <button onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>−</button>
          <span>{zoom.toFixed(1)}× · drag to pan</span>
          <button onClick={() => setZoom((z) => Math.min(3, z + 0.5))}>＋</button>
        </div>
      )}
      <div className="map-scroll">
        <svg
          className="bank-map"
          viewBox="-224 0 1344 672"
          role="img"
          aria-label="Bank map with 12 rooms, corridors, two safe holding rooms, players and loot"
          style={inspect ? { width: `${zoom * 100}%`, minWidth: 650 * zoom, maxWidth: 'none' } : {}}
        >
          <defs>
            <pattern id="floor" width="14" height="14" patternUnits="userSpaceOnUse">
              <path
                d="M 2 3 l 1 1 M 10 11 l 1 -1"
                fill="none"
                stroke="#ffffff"
                strokeOpacity=".022"
              />
            </pattern>
            <filter id="shadow">
              <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity=".5" />
            </filter>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <text x="22" y="18" className="map-caption">
            MERIDIAN NATIONAL BANK
          </text>
          <text x="898" y="18" textAnchor="end" className="map-caption">
            FLOOR 01 / LIVE SECURITY FEED
          </text>
          {SQUARES.filter(
            (s) => !ROOMS.some((r) => r.logicalSquares.some((q) => q.id === s.id)),
          ).map((s) => (
            <rect
              key={s.id}
              x={px(s.x) - 28}
              y={py(s.y) - 28}
              width="56"
              height="56"
              fill="#303a32"
            />
          ))}
          {ROOMS.map((r, i) => (
            <g key={r.id}>
              <rect
                x={px(r.x) - 28}
                y={py(r.y) - 28}
                width="168"
                height="168"
                fill={
                  r.isTreasureRoom
                    ? '#373c28'
                    : r.isHoldingRoom
                      ? '#293039'
                      : i % 3 === 0
                        ? '#303b34'
                        : '#29362e'
                }
              />
              <rect x={px(r.x) - 28} y={py(r.y) - 28} width="168" height="168" fill="url(#floor)" />
              <text x={px(r.x) - 14} y={py(r.y) - 10} className="room-number">
                {r.isHoldingRoom
                  ? r.id === 'holding'
                    ? 'H1'
                    : 'H2'
                  : String(i + 1).padStart(2, '0')}
              </text>
              <text
                x={px(r.x) + 56}
                y={py(r.y) + 130}
                textAnchor="middle"
                className={`room-name ${r.isTreasureRoom ? 'vault' : ''}`}
              >
                {r.name.toUpperCase()}
              </text>
              {/* Small environmental props sit at wall edges; the nine gameplay centers remain unobstructed. */}
              {r.isTreasureRoom ? (
                <g fill="none" stroke="#a39855" strokeWidth="3" opacity=".5">
                  <circle cx={px(r.x) + 56} cy={py(r.y) + 50} r="39" />
                  <circle cx={px(r.x) + 56} cy={py(r.y) + 50} r="28" />
                  <path
                    d={`M${px(r.x) + 36} ${py(r.y) + 50}h40 M${px(r.x) + 56} ${py(r.y) + 30}v40`}
                  />
                </g>
              ) : r.isHoldingRoom ? (
                <g stroke="#83939e" strokeWidth="4" opacity=".3">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <path key={n} d={`M${px(r.x) - 15 + n * 25} ${py(r.y) - 18}v28`} />
                  ))}
                </g>
              ) : (
                <g opacity=".4">
                  <rect
                    x={px(r.x) + 100}
                    y={py(r.y) + 18}
                    width="28"
                    height="76"
                    rx="4"
                    fill="#586955"
                  />
                  <path
                    d={`M${px(r.x) + 103} ${py(r.y) + 30}h22m-22 20h22m-22 20h22`}
                    stroke="#91a08a"
                  />
                  <circle cx={px(r.x) - 12} cy={py(r.y) + 102} r="11" fill="#536f48" />
                  <circle cx={px(r.x) - 17} cy={py(r.y) + 97} r="7" fill="#6d8657" />
                </g>
              )}
            </g>
          ))}
          <g
            className="logical-grid"
            fill="none"
            stroke="#d4dfcd"
            strokeOpacity=".16"
            strokeWidth="1"
          >
            {SQUARES.map((s) => (
              <rect key={s.id} x={px(s.x) - 28} y={py(s.y) - 28} width="56" height="56" />
            ))}
          </g>
          <g stroke="#111a16" strokeWidth="7" strokeLinecap="square">
            {WALLS.map((w, i) => (
              <line key={i} x1={px(w.a.x)} y1={py(w.a.y)} x2={px(w.b.x)} y2={py(w.b.y)} />
            ))}
          </g>
          <g stroke="#7a8675" strokeOpacity=".4" strokeWidth="1">
            {WALLS.map((w, i) => (
              <line key={i} x1={px(w.a.x)} y1={py(w.a.y)} x2={px(w.b.x)} y2={py(w.b.y)} />
            ))}
          </g>
          {(lobby
            ? ROOMS.filter((r) => !r.isHoldingRoom).flatMap((r, i) => [
                {
                  id: r.id,
                  kind: r.isTreasureRoom ? 5 : i % 5,
                  squareId: r.logicalSquares[(i * 2) % 9].id,
                },
              ])
            : state.loot
          ).map((l, i) => {
            const s = squareById[l.squareId],
              stack = (lobby ? [] : state.loot)
                .filter((a) => a.squareId === l.squareId)
                .findIndex((a) => a.id === l.id);
            return (
              <g
                key={l.id}
                onClick={() =>
                  inspect &&
                  setDetail(
                    `${LOOT[l.kind].name} · $${LOOT[l.kind].value.toLocaleString()} · square ${l.squareId}`,
                  )
                }
                transform={`translate(${px(s.x) + Math.min(Math.max(0, stack), 4) * 4},${py(s.y) + 12})`}
              >
                <title>
                  {LOOT[l.kind].name} · ${LOOT[l.kind].value}
                </title>
                <ellipse rx="15" ry="6" cy="10" fill="#0d130e" opacity=".5" />
                <text
                  textAnchor="middle"
                  className={`map-loot ${l.kind === 5 ? 'diamond' : ''}`}
                  style={{ animationDelay: `${i * 0.12}s` }}
                >
                  {LOOT[l.kind].icon}
                </text>
              </g>
            );
          })}
          {effect?.kind === 'shot.hit' && poses[effect.actorId] && poses[effect.targetId ?? ''] && (
            <line
              className="bullet"
              x1={px(poses[effect.actorId].x)}
              y1={py(poses[effect.actorId].y)}
              x2={px(poses[effect.targetId!].x)}
              y2={py(poses[effect.targetId!].y)}
              stroke="#ffdd86"
              strokeWidth="4"
            />
          )}
          {[
            ...state.players.map((p) => ({ ...p, sheriff: false })),
            {
              id: 'sheriff',
              name: 'Sheriff',
              avatar: '★',
              color: '#ddb45d',
              sheriff: true,
            },
          ].map((p) => {
            const pose = poses[p.id];
            if (!pose) return null;
            const active = state.current?.playerId === p.id;
            const reaction = reactions
              .filter((r) => r.playerId === p.id && Date.now() - r.at < 2400)
              .at(-1);
            return (
              <g
                key={p.id}
                onClick={() =>
                  inspect &&
                  setDetail(
                    `${p.name}${'squareId' in p ? ` · square ${p.squareId} · $${p.lootValue.toLocaleString()} carried` : ' · arrests everyone in the same room'}`,
                  )
                }
                transform={`translate(${px(pose.x)},${py(pose.y)})`}
              >
                <title>
                  {p.name}
                  {'squareId' in p ? ` · ${p.squareId}` : ''}
                </title>
                {active && (
                  <circle
                    r="29"
                    fill="none"
                    stroke={p.color}
                    opacity=".65"
                    strokeWidth="2"
                    className="active-ring"
                  />
                )}
                <g transform={`scale(${pose.size})`} filter="url(#shadow)">
                  <ellipse cy="21" rx="24" ry="7" fill="#0b110d" opacity=".5" />
                  <path
                    d="M-14 5 Q-31 6 -25 18 M14 5 Q31 6 25 18"
                    fill="none"
                    stroke={p.color}
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                  <circle cx="-25" cy="18" r="5" fill="#d3b68e" />
                  <circle cx="25" cy="18" r="5" fill="#d3b68e" />
                  <circle r="21" fill="#17211a" stroke={p.color} strokeWidth="3" />
                  {p.avatar.startsWith('data:') || p.avatar.startsWith('/api/avatar/') ? (
                    <>
                      <clipPath id={`clip-${p.id}`}>
                        <circle r="18" />
                      </clipPath>
                      <image
                        href={p.avatar}
                        x="-18"
                        y="-18"
                        width="36"
                        height="36"
                        clipPath={`url(#clip-${p.id})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </>
                  ) : (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={p.sheriff ? 29 : 27}
                      fill={p.color}
                    >
                      {p.avatar}
                    </text>
                  )}
                </g>
                {(active || inspect) && (
                  <text y="-33" textAnchor="middle" className="character-label">
                    {p.name}
                  </text>
                )}
                {effect?.actorId === p.id && /loot|punch|shot|arrest/.test(effect.kind) && (
                  <text y="-40" textAnchor="middle" className="action-pop">
                    {effect.kind.startsWith('loot')
                      ? '◆'
                      : effect.kind.startsWith('punch')
                        ? '✊'
                        : effect.kind.startsWith('shot')
                          ? '✦'
                          : '⛓'}
                  </text>
                )}
                {reaction && (
                  <text
                    key={reaction.at}
                    y="-42"
                    textAnchor="middle"
                    fontSize="36"
                    className="reaction"
                  >
                    {reaction.emoji}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {inspect && (
        <div className="map-detail" role="status">
          {detail}
        </div>
      )}
    </div>
  );
}
