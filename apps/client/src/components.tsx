import { useState, type CSSProperties } from 'react';
import { BALANCE, LOOT, PALETTE } from '../../../packages/shared/config';
import type { PublicPlayer, PublicState, WheelState } from '../../../packages/shared/types';
export function Avatar({
  avatar,
  color,
  size = 38,
}: {
  avatar: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      className="avatar"
      style={{ '--player-color': color, width: size, height: size } as CSSProperties}
    >
      {avatar.startsWith('data:') || avatar.startsWith('/api/avatar/') ? (
        <img src={avatar} alt="Player portrait" />
      ) : (
        <span>{avatar}</span>
      )}
    </span>
  );
}
export function Money({ value }: { value: number }) {
  return (
    <>
      {value < 0 ? '−' : ''}${Math.abs(value).toLocaleString()}
    </>
  );
}
export function Timer({ endsAt, now }: { endsAt: number; now: number }) {
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <span className={`timer ${seconds <= 10 ? 'urgent' : ''}`}>
      {Math.floor(seconds / 60)
        .toString()
        .padStart(2, '0')}
      :{(seconds % 60).toString().padStart(2, '0')}
    </span>
  );
}
export function PhaseStrip({ state }: { state: PublicState }) {
  return (
    <div className="phase-strip">
      {state.round.phases.map((p) => (
        <span
          key={p.index}
          className={`${p.repeatCount === 2 ? 'double' : ''} ${state.current?.phase === p.index ? 'current' : ''}`}
        >
          mA{p.index + 1}
          <b>×{p.repeatCount}</b>
        </span>
      ))}
    </div>
  );
}
export function RandomWheel({ wheel, now }: { wheel: WheelState; now: number }) {
  const [duration] = useState(Math.max(300, wheel.endsAt - now - 180));
  const winner = wheel.entries.findIndex((e) => e.id === wheel.winnerId),
    angle = 360 / wheel.entries.length;
  const gradient = wheel.entries
    .map((_, i) => `${PALETTE[i % PALETTE.length]} ${i * angle}deg ${(i + 1) * angle}deg`)
    .join(',');
  return (
    <div className="wheel-overlay">
      <div className="wheel-panel">
        <span className="eyebrow">LET FATE DECIDE</span>
        <h2>{wheel.title}</h2>
        <div className="wheel-wrap">
          <div className="wheel-pointer">▼</div>
          <div
            className="wheel"
            style={
              {
                background: `conic-gradient(${gradient})`,
                '--landing': `${1800 - winner * angle - angle / 2}deg`,
                animationDuration: `${duration}ms`,
              } as CSSProperties
            }
          >
            {wheel.entries.map((e, i) => (
              <span
                key={e.id}
                style={{
                  transform: `rotate(${i * angle + angle / 2}deg) translateY(-83px) rotate(90deg)`,
                }}
              >
                {i + 1}
              </span>
            ))}
          </div>
          <span className="wheel-hub">◆</span>
        </div>
        <strong className="wheel-result">{wheel.entries[winner].label}</strong>
        <div className="wheel-options">
          {wheel.entries.map((e, i) => (
            <small key={e.id}>
              {i + 1}. {e.label}
            </small>
          ))}
        </div>
      </div>
    </div>
  );
}
export function Results({ state, onAgain }: { state: PublicState; onAgain?: () => void }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score || b.lootValue - a.lootValue);
  return (
    <section
      className="results"
      style={{ '--result-count': Math.max(1, ranked.length) } as CSSProperties}
    >
      <span className="eyebrow">THE FINAL TAKE</span>
      <h1>
        Crime pays.
        <br />
        <em>Sometimes.</em>
      </h1>
      <p>
        Loot + <Money value={BALANCE.successfulHitBonus} /> per hit dealt −{' '}
        <Money value={BALANCE.receivedHitPenalty} /> per hit received.
      </p>
      <div className="result-list">
        {ranked.map((p, i) => (
          <div key={p.id} className={`result-row ${i === 0 ? 'winner' : ''}`}>
            <span className="rank">{i === 0 ? '♛' : String(i + 1).padStart(2, '0')}</span>
            <Avatar avatar={p.avatar} color={p.color} size={48} />
            <div>
              <strong>{p.name}</strong>
              <small>{i === 0 ? 'THE MASTERMIND' : 'CREW MEMBER'}</small>
            </div>
            <div className="result-stats">
              <span>
                Loot{' '}
                <b>
                  <Money value={p.lootValue} />
                </b>
              </span>
              <span>
                Shots <b>{p.shots}</b>
              </span>
              <span>
                Hits dealt <b>{p.hitsDealt}</b>
              </span>
              <span>
                Hits taken <b>{p.hitsReceived}</b>
              </span>
              <span>
                Arrests <b>{p.arrests}</b>
              </span>
              <span>
                Junk <b>{p.junk}</b>
              </span>
            </div>
            <strong className="score">
              <Money value={p.score} />
            </strong>
          </div>
        ))}
      </div>
      {onAgain && (
        <button className="primary" onClick={onAgain}>
          Plan another heist ↗
        </button>
      )}
    </section>
  );
}
export function LootBag({ player }: { player: PublicPlayer }) {
  return (
    <div className="loot-bag">
      {player.loot.length ? (
        player.loot.map((l) => (
          <span key={l.id} title={`${LOOT[l.kind].name} $${LOOT[l.kind].value}`}>
            {LOOT[l.kind].icon}
          </span>
        ))
      ) : (
        <small>Your bag is empty. For now.</small>
      )}
    </div>
  );
}
