import { useId, useState } from 'react';
import { BALANCE, LABELS, type Direction } from '../../../packages/shared/config';
import { ROOMS, roomById, squareById, type LogicalSquare } from '../../../packages/shared/map';
import { predictProgram } from '../../../packages/shared/prediction';
import type { Card, ProgrammedAction, PublicPlayer } from '../../../packages/shared/types';
import { Avatar, Timer } from './components';

export function MapIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z M9 3v16 M15 5v16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanningMap({
  path,
  player,
  roomIds,
}: {
  path: LogicalSquare[];
  player: PublicPlayer;
  roomIds: string[];
}) {
  const clip = useId();
  const rooms = ROOMS.filter((r) => roomIds.includes(r.id) || path.some((s) => s.roomId === r.id));
  const minX = Math.min(...rooms.map((r) => r.x)) - 0.7,
    minY = Math.min(...rooms.map((r) => r.y)) - 0.7;
  const maxX = Math.max(...rooms.map((r) => r.x + 3)) - 0.3,
    maxY = Math.max(...rooms.map((r) => r.y + 3)) - 0.1;
  const from = path[0],
    to = path.at(-1)!;
  return (
    <svg
      className="planning-map"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      role="img"
      aria-label={`Predicted path from ${from.id} to ${to.id}`}
    >
      <defs>
        <clipPath id={clip}>
          <circle cx={from.x} cy={from.y} r=".27" />
        </clipPath>
      </defs>
      {ROOMS.map((r) => (
        <g key={r.id}>
          <rect
            x={r.x - 0.5}
            y={r.y - 0.5}
            width="3"
            height="3"
            rx=".06"
            fill={r.isHoldingRoom ? '#293948' : '#293d30'}
            stroke="#76836a"
            strokeWidth=".025"
          />
          {r.logicalSquares.map((s) => (
            <rect
              key={s.id}
              x={s.x - 0.5}
              y={s.y - 0.5}
              width="1"
              height="1"
              fill="none"
              stroke="#c1d2b8"
              strokeOpacity=".22"
              strokeWidth=".015"
            />
          ))}
          <text x={r.x + 1} y={r.y + 2.38} textAnchor="middle" fontSize=".16" fill="#d1d9c5">
            {r.name}
          </text>
          {r.doors.map((d) => {
            const a = squareById[d.from],
              b = squareById[d.to];
            return (
              <line
                key={d.roomId}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#6e876b"
                strokeWidth=".1"
              />
            );
          })}
        </g>
      ))}
      <rect
        x={to.x - 0.43}
        y={to.y - 0.43}
        width=".86"
        height=".86"
        rx=".08"
        fill={player.color}
        fillOpacity=".28"
        stroke={player.color}
        strokeWidth=".05"
      />
      <polyline
        points={path.map((s) => `${s.x},${s.y}`).join(' ')}
        fill="none"
        stroke="#eff5e9"
        strokeWidth=".075"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={path.map((s) => `${s.x},${s.y}`).join(' ')}
        fill="none"
        stroke={player.color}
        strokeWidth=".045"
        strokeDasharray=".14 .1"
      />
      {path.slice(1).map((s, i) => (
        <circle
          key={`${i}-${s.id}`}
          cx={s.x}
          cy={s.y}
          r=".08"
          fill={player.color}
          stroke="#fff"
          strokeWidth=".015"
        />
      ))}
      <circle cx={from.x} cy={from.y} r=".33" fill="#17271c" stroke="#fff" strokeWidth=".075" />
      <circle
        cx={from.x}
        cy={from.y}
        r=".31"
        fill="#17271c"
        stroke={player.color}
        strokeWidth=".065"
      />
      {player.avatar.startsWith('/api/') || player.avatar.startsWith('data:') ? (
        <image
          href={player.avatar}
          x={from.x - 0.27}
          y={from.y - 0.27}
          width=".54"
          height=".54"
          clipPath={`url(#${clip})`}
        />
      ) : (
        <text
          x={from.x}
          y={from.y + 0.02}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize=".43"
        >
          {player.avatar}
        </text>
      )}
    </svg>
  );
}

export function ActionPlanner({
  card,
  player,
  origin,
  initial,
  uncertain,
  endsAt,
  now,
  onConfirm,
  onClose,
}: {
  card: Card;
  player: PublicPlayer;
  origin: string;
  initial?: ProgrammedAction;
  uncertain: boolean;
  endsAt: number;
  now: number;
  onConfirm: (
    params: Pick<ProgrammedAction, 'direction' | 'distance' | 'destinationRoomId'>,
  ) => void;
  onClose: () => void;
}) {
  const adjacent = roomById[squareById[origin].roomId].connectedRoomIds;
  const [direction, setDirection] = useState<Direction>(initial?.direction ?? 'UP');
  const [distance, setDistance] = useState(initial?.distance ?? 1);
  const [room, setRoom] = useState(
    adjacent.includes(initial?.destinationRoomId ?? '') ? initial!.destinationRoomId! : adjacent[0],
  );
  const proposal: ProgrammedAction =
    card.type === 'MOVE'
      ? { type: 'MOVE', direction, distance }
      : { type: 'GO_OTHER_ROOM', destinationRoomId: room };
  const prediction = predictProgram(origin, [proposal])[0];
  const predictNextMove = prediction.predictNextMove;
  const originRoom = roomById[squareById[origin].roomId],
    destinationRoom = roomById[squareById[predictNextMove].roomId];
  return (
    <div className="planner-backdrop">
      <section
        className="action-planner"
        role="dialog"
        aria-modal="true"
        aria-label={`${LABELS[card.type]} planner`}
      >
        <header className="planner-heading">
          <Avatar avatar={player.avatar} color={player.color} size={34} />
          <div>
            <span className="eyebrow">{player.name} · PLAN THE NEXT STEP</span>
            <h2>{LABELS[card.type]}</h2>
          </div>
          <Timer endsAt={endsAt} now={now} />
          <button className="planner-close" aria-label="Close planner" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="prediction-summary">
          <span>
            FROM <b>{originRoom.name}</b> <small>({origin})</small>
          </span>
          <span>→</span>
          <span>
            TO <b>{destinationRoom.name}</b> <small>({predictNextMove})</small>
          </span>
        </div>
        <div className="planner-content">
          <div className="planner-map-frame">
            <PlanningMap
              path={prediction.path}
              player={player}
              roomIds={
                card.type === 'GO_OTHER_ROOM' ? [originRoom.id, ...adjacent] : [originRoom.id]
              }
            />
            <span className="path-legend">
              <i /> Your predicted path · ◎ arrival
            </span>
          </div>
          <div className="planner-controls">
            {card.type === 'MOVE' ? (
              <>
                <div className="direction-pad">
                  {(
                    [
                      'UP_LEFT',
                      'UP',
                      'UP_RIGHT',
                      'LEFT',
                      null,
                      'RIGHT',
                      'DOWN_LEFT',
                      'DOWN',
                      'DOWN_RIGHT',
                    ] as const
                  ).map((d, i) =>
                    d ? (
                      <button
                        key={d}
                        className={direction === d ? 'selected' : ''}
                        onClick={() => setDirection(d)}
                        aria-label={d}
                      >
                        {['↖', '↑', '↗', '←', '', '→', '↙', '↓', '↘'][i]}
                      </button>
                    ) : (
                      <span key="center">✥</span>
                    ),
                  )}
                </div>
                <label className="distance-control">
                  Distance{' '}
                  <b>
                    {distance} / {BALANCE.maxMove}
                  </b>
                  <input
                    aria-label="Movement distance"
                    type="range"
                    min="1"
                    max={BALANCE.maxMove}
                    value={distance}
                    onChange={(e) => setDistance(Number(e.target.value))}
                  />
                </label>
                <small className="wall-hint">
                  {prediction.path.length - 1 < distance
                    ? `Wall stops you after ${prediction.path.length - 1} squares.`
                    : `Travel ${distance} squares.`}
                </small>
              </>
            ) : (
              <>
                <span className="eyebrow">EXITS FROM {originRoom.name.toUpperCase()}</span>
                <div className="room-picker">
                  {adjacent.map((id) => (
                    <button
                      key={id}
                      className={room === id ? 'selected' : ''}
                      onClick={() => setRoom(id)}
                    >
                      {roomById[id].name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="prediction-note">
          {uncertain
            ? 'An earlier room choice may need a random exit. This position is an estimate.'
            : 'Based on your earlier programmed moves. Other players and the Sheriff can change the result.'}
        </p>
        <button
          className="primary"
          onClick={() =>
            onConfirm(card.type === 'MOVE' ? { direction, distance } : { destinationRoomId: room })
          }
        >
          Program {LABELS[card.type]} <span>↗</span>
        </button>
      </section>
    </div>
  );
}
