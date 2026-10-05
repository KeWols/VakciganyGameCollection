import { useEffect, useState, type CSSProperties } from 'react';
import {
  ACTIONS,
  BALANCE,
  DEFAULT_SETTINGS,
  LABELS,
  LIMITS,
} from '../../../packages/shared/config';
import type { GameSettings } from '../../../packages/shared/types';
import { BankMap } from './BankMap';
import { Avatar, Money, PhaseStrip, RandomWheel, Results, Timer } from './components';
import type { GameConnection } from './useGame';
export function Host({ game }: { game: GameConnection }) {
  const { snapshot, send, now, reactions } = game;
  const [settings, setSettings] = useState<GameSettings>(structuredClone(DEFAULT_SETTINGS)),
    [network, setNetwork] = useState<string[]>([]),
    [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    fetch('/api/network')
      .then((r) => r.json())
      .then((d) => setNetwork(d.addresses))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (snapshot?.state.settings) setSettings(snapshot.state.settings);
  }, [
    snapshot?.state.settings.rounds,
    snapshot?.state.settings.selectionSeconds,
    snapshot?.state.settings.targetSeconds,
    snapshot?.state.settings.lootCount,
    JSON.stringify(snapshot?.state.settings.deck),
  ]);
  if (!snapshot) return <div className="loading">Connecting to the bank…</div>;
  const s = snapshot.state,
    lobby = s.phase === 'LOBBY';
  const order = s.round.order.length ? s.round.order : s.players.map((p) => p.id);
  const active = s.players.find((p) => p.id === s.current?.playerId);
  const joinUrl = `${location.protocol}//${network[0] ?? location.hostname}:${location.port || (location.protocol === 'https:' ? '443' : '80')}/player`;
  const save = () => {
    send('game.host.settings.update', settings);
    setSettingsOpen(false);
  };
  return (
    <div className={`host host-tv ${lobby ? 'host-lobby' : ''}`}>
      <header className="host-header">
        <a className="brand" href="/host">
          <span className="brand-mark">
            M<span>W</span>
          </span>
          <div>
            MIDNIGHT
            <br />
            <strong>WITHDRAWAL</strong>
          </div>
        </a>
        <div className="header-status">
          <span className="live-dot" />
          {lobby
            ? 'ASSEMBLING THE CREW'
            : s.phase === 'ACTION_SELECTION'
              ? 'THE PLANNING PHASE'
              : s.phase === 'ACTION_MOVIE'
                ? 'THE ACTION MOVIE'
                : 'HEIST COMPLETE'}
        </div>
        <div className="round-counter">
          <span>
            {lobby
              ? 'ONE BANK. ZERO GOOD IDEAS.'
              : `ROUND ${String(s.round.number).padStart(2, '0')} / ${String(s.settings.rounds).padStart(2, '0')}`}
          </span>
          {s.phase === 'ACTION_SELECTION' && <Timer endsAt={s.phaseEndsAt} now={now} />}
        </div>
      </header>
      {s.phase === 'RESULTS' ? (
        <Results state={s} onAgain={() => send('game.host.reset')} />
      ) : (
        <main className="host-layout">
          <aside className={`crew-panel ${s.players.length > 10 ? 'dense-crew' : ''}`}>
            <div className="panel-heading">
              <span className="eyebrow">{lobby ? 'THE CREW' : 'EXECUTION ORDER'}</span>
              <span className="count-pill">
                {s.players.length}/{BALANCE.maxPlayers}
              </span>
            </div>
            <h2>{lobby ? 'Partners in crime.' : 'Who moves next?'}</h2>
            <p className="muted">
              {lobby
                ? 'A phone, a plan, and questionable friends.'
                : `${s.players.filter((p) => p.ready).length} / ${s.players.length} ready · order changes each round`}
            </p>
            <div
              className="crew-list"
              style={
                {
                  '--crew-rows': Math.max(
                    1,
                    s.players.length > 10 ? Math.ceil(s.players.length / 2) : s.players.length,
                  ),
                } as CSSProperties
              }
            >
              {order.map((id, i) => {
                const p = s.players.find((p) => p.id === id)!;
                return (
                  <div
                    key={id}
                    className={`crew-row ${s.current?.playerId === id ? 'acting' : ''}`}
                    style={{ borderLeftColor: p.color }}
                  >
                    <span className="order-number">{String(i + 1).padStart(2, '0')}</span>
                    <Avatar avatar={p.avatar} color={p.color} />
                    <div className="crew-name">
                      <strong title={p.name}>{p.name}</strong>
                      <small>
                        {lobby ? (
                          p.connected ? (
                            'Connected'
                          ) : (
                            'Reconnecting…'
                          )
                        ) : (
                          <Money value={p.lootValue} />
                        )}
                      </small>
                    </div>
                    <span
                      title={p.ready ? 'Ready' : p.connected ? 'Connected' : 'Offline'}
                      className={p.ready ? 'ready-tick' : 'connection-dot'}
                    >
                      {p.ready ? '✓' : p.connected ? '●' : '○'}
                    </span>
                    {lobby && (
                      <button
                        className="kick-player"
                        title={`Kick ${p.name}`}
                        aria-label={`Kick ${p.name}`}
                        onClick={() => send('game.host.player.kick', { playerId: p.id })}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              {!s.players.length && (
                <div className="empty-crew">
                  <span>＋</span>
                  <strong>Your crew goes here</strong>
                  <small>
                    Open the controller on a phone
                    <br />
                    to join the heist.
                  </small>
                </div>
              )}
            </div>
            <div className="join-card">
              <span className="eyebrow">JOIN ON YOUR PHONE</span>
              <strong>Same Wi-Fi. Any browser.</strong>
              <a href={joinUrl} target="_blank" rel="noreferrer">
                {joinUrl.replace(/^https?:\/\//, '')}
              </a>
              <button
                className="text-button"
                onClick={() => {
                  void navigator.clipboard?.writeText(joinUrl);
                }}
              >
                Copy controller link ↗
              </button>
            </div>
            <div className="broker-note">
              <i />{' '}
              {snapshot.broker === 'rabbitmq' ? 'RabbitMQ connected' : 'Development memory broker'}
            </div>
          </aside>
          <section className="map-panel">
            <div className="map-topline">
              <div>
                <span className="eyebrow">THE SCENE OF THE CRIME</span>
                <h1>
                  Meridian National Bank<span>01</span>
                </h1>
              </div>
              <span className="security-label">◉ LIVE</span>
            </div>
            <BankMap state={s} now={now} reactions={reactions} />
            <div className="map-bottom">
              <span>12 ROOMS + 2 HOLDING ROOMS · FAINT LINES = LOGICAL SQUARES</span>
              <span className="gold">HOLDING ROOMS ARE SAFE FROM THE SHERIFF.</span>
            </div>
          </section>
          <aside className="director-panel">
            {lobby ? (
              <>
                <div className="director-title">
                  <span className="eyebrow">THE HEIST BRIEF</span>
                  <h2>
                    Make a plan. <em>Watch it fall apart.</em>
                  </h2>
                  <small>Join on your phone → program actions → watch the movie.</small>
                </div>
                <div className="settings-summary">
                  <span>
                    Rounds<strong>{s.settings.rounds}</strong>
                  </span>
                  <span>
                    Planning<strong>{s.settings.selectionSeconds}s</strong>
                  </span>
                  <span>
                    Targets<strong>{s.settings.targetSeconds}s</strong>
                  </span>
                  <span>
                    Loot<strong>{s.settings.lootCount}</strong>
                  </span>
                </div>
                <div className="host-controls">
                  <button className="secondary" onClick={() => setSettingsOpen(true)}>
                    ⚙ Customize the heist
                  </button>
                  <button
                    className="primary start-button"
                    disabled={!s.players.length || !game.connected}
                    onClick={() => send('game.host.start')}
                  >
                    Start the heist ↗
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="round-script">
                  <span className="eyebrow">
                    ROUND {s.round.number} · {s.players.filter((p) => p.ready).length}/
                    {s.players.length} READY
                  </span>
                  <PhaseStrip state={s} />
                </div>
                <div className="current-action">
                  <span className="eyebrow">
                    {s.current
                      ? `mA${s.current.phase + 1} · ACTION ${s.current.repeat + 1}/${s.round.phases[s.current.phase].repeatCount}`
                      : 'PROGRAMMING IN PROGRESS'}
                  </span>
                  <h3>
                    {s.target
                      ? `${active?.name} is choosing a target…`
                      : s.current?.playerId === 'sheriff'
                        ? 'Sheriff on patrol'
                        : s.phase === 'ACTION_SELECTION'
                          ? 'Keep your plans close.'
                          : active?.name}
                  </h3>
                  <p>{s.effect?.text}</p>
                  {s.target && <Timer endsAt={s.target.endsAt} now={now} />}
                </div>
                <div className="event-log">
                  <span className="eyebrow">THE PAPER TRAIL</span>
                  {s.log.slice(0, 2).map((line, i) => (
                    <p key={`${i}-${line}`} className={i === 0 ? 'latest' : ''}>
                      {line}
                    </p>
                  ))}
                </div>
              </>
            )}
          </aside>
        </main>
      )}
      {s.wheel && <RandomWheel key={s.wheel.id} wheel={s.wheel} now={now} />}
      {settingsOpen && (
        <div className="modal-backdrop">
          <section className="settings-modal">
            <button className="close" onClick={() => setSettingsOpen(false)}>
              ×
            </button>
            <span className="eyebrow">HOUSE RULES</span>
            <h2>Customize the heist</h2>
            <div className="settings-fields">
              {(['rounds', 'selectionSeconds', 'targetSeconds', 'lootCount'] as const).map(
                (key) => (
                  <label key={key}>
                    {
                      {
                        rounds: 'Game rounds',
                        selectionSeconds: 'Planning time (seconds)',
                        targetSeconds: 'Target time (seconds)',
                        lootCount: 'Initial loot count',
                      }[key]
                    }
                    <input
                      type="number"
                      min={LIMITS[key][0]}
                      max={LIMITS[key][1]}
                      value={settings[key]}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          [key]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ),
              )}
            </div>
            <h3>Personal action deck</h3>
            <div className="settings-fields">
              {ACTIONS.map((type) => (
                <label key={type}>
                  {LABELS[type]}
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={settings.deck[type]}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        deck: {
                          ...settings.deck,
                          [type]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <p className="muted">
              Each robber gets their own deck. Keep at least one usable card. Skip & Draw is always
              available.
            </p>
            <button className="primary" onClick={save}>
              Save settings
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
