import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AVATARS, EMOJIS, ICONS, LABELS, foreground } from '../../../packages/shared/config';
import { roomById, squareById } from '../../../packages/shared/map';
import type { Card, ProgrammedAction, PublicPlayer } from '../../../packages/shared/types';
import { predictedOrigin, predictProgram } from '../../../packages/shared/prediction';
import { ActionPlanner, MapIcon } from './ActionPlanner';
import { BankMap } from './BankMap';
import { Avatar, LootBag, Money, PhaseStrip, Results, Timer } from './components';
import type { GameConnection } from './useGame';
function PhotoCrop({
  source,
  onSave,
  onCancel,
}: {
  source: string;
  onSave: (image: string) => void;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [zoom, setZoom] = useState(1),
    [x, setX] = useState(0),
    [y, setY] = useState(0),
    [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.src = source;
  }, [source]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !image) return;
    const base = 240 / Math.min(image.width, image.height),
      scale = base * zoom,
      w = image.width * scale,
      h = image.height * scale;
    ctx.clearRect(0, 0, 240, 240);
    ctx.drawImage(
      image,
      (240 - w) / 2 + (x * (w - 240)) / 2,
      (240 - h) / 2 + (y * (h - 240)) / 2,
      w,
      h,
    );
  }, [image, zoom, x, y]);
  return (
    <div className="modal-backdrop">
      <section className="crop-modal">
        <h2>Your face. Your alibi.</h2>
        <p>Frame your profile picture.</p>
        <canvas ref={canvas} width="240" height="240" />
        <label>
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step=".01"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <label>
          Horizontal
          <input
            type="range"
            min="-1"
            max="1"
            step=".01"
            value={x}
            onChange={(e) => setX(+e.target.value)}
          />
        </label>
        <label>
          Vertical
          <input
            type="range"
            min="-1"
            max="1"
            step=".01"
            value={y}
            onChange={(e) => setY(+e.target.value)}
          />
        </label>
        <button
          className="primary"
          onClick={() => {
            if (canvas.current) onSave(canvas.current.toDataURL('image/jpeg', 0.82));
          }}
        >
          Use this face
        </button>
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
      </section>
    </div>
  );
}
function Join({
  game,
  profile,
  onClose,
}: {
  game: GameConnection;
  profile?: PublicPlayer;
  onClose?: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? ''),
    [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS[0]),
    [photo, setPhoto] = useState('');
  const upload = (file?: File) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      game.setError('Choose a JPEG, PNG, WebP or GIF image.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      game.setError('Please use an image under 12 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <main className="join-screen">
      <div className="join-wordmark">
        MIDNIGHT <strong>WITHDRAWAL</strong>
      </div>
      <span className="eyebrow">A PARTY HEIST. A TERRIBLE IDEA.</span>
      <h1>
        {profile ? 'Update your' : 'Meet your'}
        <br />
        <em>{profile ? 'next alibi.' : 'bad influence.'}</em>
      </h1>
      <p>
        Every good heist starts with a face
        <br />
        you probably shouldn’t trust.
      </p>
      <div className="profile-preview">
        <Avatar avatar={avatar} color={profile?.color ?? '#dec580'} size={104} />
        <button
          aria-label="Random avatar"
          onClick={() => setAvatar(AVATARS[Math.floor(Math.random() * AVATARS.length)])}
        >
          ⤨
        </button>
      </div>
      <div className="avatar-picker">
        {AVATARS.map((a) => (
          <button
            key={a}
            className={a === avatar ? 'selected' : ''}
            onClick={() => setAvatar(a)}
            aria-label={`Choose ${a}`}
          >
            {a}
          </button>
        ))}
      </div>
      <div className="photo-options">
        <label className="secondary">
          ↥ Upload photo
          <input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        <label className="secondary">
          ◎ Take selfie
          <input
            type="file"
            accept="image/*"
            capture="user"
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          game.send(profile ? 'game.player.profile.update' : 'game.player.join', {
            name,
            ...(!avatar.startsWith('/api/') ? { avatar } : {}),
          });
          onClose?.();
        }}
      >
        <label className="eyebrow" htmlFor="player-name">
          WHAT DO WE CALL YOU?
        </label>
        <input
          id="player-name"
          className="name-input"
          placeholder="Your criminal alias"
          value={name}
          maxLength={24}
          required
          onChange={(e) => setName(e.target.value)}
          autoComplete="nickname"
        />
        <button
          className="primary"
          disabled={
            !game.connected || !name.trim() || (!profile && game.snapshot?.state.phase !== 'LOBBY')
          }
        >
          {profile ? 'Save profile' : 'I’m in'} <span>↗</span>
        </button>
      </form>
      {onClose && (
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
      )}
      <small className="muted">No account. No download. Absolutely no alibi.</small>
      {photo && (
        <PhotoCrop
          source={photo}
          onCancel={() => setPhoto('')}
          onSave={(data) => {
            setAvatar(data);
            setPhoto('');
          }}
        />
      )}
    </main>
  );
}
export function Player({ game }: { game: GameConnection }) {
  const { snapshot, now, send } = game;
  const [mapOpen, setMapOpen] = useState(false),
    [editing, setEditing] = useState<number | null>(null),
    [chosen, setChosen] = useState<Card | null>(null),
    [profileOpen, setProfileOpen] = useState(false);
  const s = snapshot?.state,
    me = snapshot?.me,
    p = s?.players.find((p) => p.id === snapshot?.playerId);
  useEffect(() => {
    setEditing(null);
    setChosen(null);
    setMapOpen(false);
    setProfileOpen(false);
  }, [s?.round.number, s?.phase]);
  useEffect(() => {
    setChosen(null);
    setEditing(null);
  }, [JSON.stringify(me?.program)]);
  if (!snapshot) return <div className="loading">Connecting your getaway phone…</div>;
  if (!p || !me || !s) return <Join game={game} />;
  const slotLabels = s.round.phases.flatMap((f) =>
    Array.from(
      { length: f.repeatCount },
      (_, i) => `mA${f.index + 1}${f.repeatCount === 2 ? (i === 0 ? '·A' : '·B') : ''}`,
    ),
  );
  const slot = editing ?? me.program.length,
    complete = me.program.length === slotLabels.length,
    canProgram = s.phase === 'ACTION_SELECTION' && !p.ready;
  const origin = p.squareId ? predictedOrigin(p.squareId, me.program, slot) : '';
  const predictions = p.squareId ? predictProgram(p.squareId, me.program) : [];
  const submit = (
    card: Card,
    params: Pick<ProgrammedAction, 'direction' | 'distance' | 'destinationRoomId'> = {},
  ) => {
    const payload = {
      slot,
      cardId: card.id,
      ...params,
    };
    send('game.action.program', payload);
  };
  const select = (card: Card) => {
    if (card.type === 'HIT_JUNK' || card.type === 'SHERIFF_JUNK') return;
    if (card.type === 'MOVE' || card.type === 'GO_OTHER_ROOM') {
      setChosen(card);
    } else submit(card);
  };
  const cards = [
    ...me.deck.hand,
    ...(editing !== null && me.program[editing]?.card ? [me.program[editing].card!] : []),
  ];
  return (
    <div
      className="controller"
      style={
        {
          '--player-color': p.color,
          '--player-ink': foreground(p.color),
          '--player-accent': p.color === '#000000' ? '#bac5b5' : p.color,
        } as CSSProperties
      }
    >
      <header className="controller-header">
        <Avatar avatar={p.avatar} color={p.color} size={48} />
        <div>
          <strong>{p.name}</strong>
          <small>
            {p.squareId
              ? roomById[squareById[p.squareId].roomId].name
              : 'CREW MEMBER · READY FOR TROUBLE'}
          </small>
        </div>
        <div className="pocket-total">
          <Money value={p.lootValue} />
          <small>IN THE BAG</small>
        </div>
      </header>
      <div className="identity-ribbon">
        <i />
        <strong>{p.name}</strong>
        <span>Your color · your crew identity</span>
        {(s.phase === 'LOBBY' || s.phase === 'RESULTS') && (
          <button onClick={() => setProfileOpen(true)}>Edit profile ✎</button>
        )}
      </div>
      {s.phase === 'LOBBY' ? (
        <section className="waiting">
          <div className="ticket">
            <span className="eyebrow">YOU’RE ON THE INSIDE</span>
            <Avatar avatar={p.avatar} color={p.color} size={110} />
            <h1>
              Looking
              <br />
              <em>suspicious.</em>
            </h1>
            <p>
              You’re in. Keep this tab open.
              <br />
              The host will start the heist.
            </p>
            <div className="ticket-line" />
            <span className="eyebrow">{s.players.length} / 20 CREW MEMBERS CONNECTED</span>
            <div className="mini-crew">
              {s.players.map((x) => (
                <Avatar key={x.id} avatar={x.avatar} color={x.color} size={32} />
              ))}
            </div>
          </div>
          <p className="muted">Your color is your calling card.</p>
        </section>
      ) : s.phase === 'RESULTS' ? (
        <Results state={s} />
      ) : s.phase === 'ACTION_SELECTION' ? (
        <main className="planning">
          <div className="controller-phase">
            <div>
              <span className="eyebrow">
                ROUND {s.round.number} / {s.settings.rounds}
              </span>
              <h2>{p.ready ? 'Plan locked.' : 'Plot your next move.'}</h2>
            </div>
            <Timer endsAt={s.phaseEndsAt} now={now} />
          </div>
          <PhaseStrip state={s} />
          {me.reshuffleUntil > now && !me.program.length && (
            <div className="reshuffle">
              <span>
                Fresh start? Reshuffle hand + deck{' '}
                <b>{Math.ceil((me.reshuffleUntil - now) / 1000)}s</b>
              </span>
              <button onClick={() => send('game.player.reshuffle')}>Reshuffle</button>
            </div>
          )}
          <div className="program-label">
            <span className="eyebrow">
              YOUR PLAN · {me.program.length}/{slotLabels.length}
            </span>
            <button className="text-button" onClick={() => setMapOpen(true)}>
              <MapIcon /> Inspect map
            </button>
          </div>
          {origin && (
            <div className="predicted-location">
              Next starting point: <strong>{roomById[squareById[origin].roomId].name}</strong>{' '}
              <small>({origin}) · predicted</small>
            </div>
          )}
          <div className="action-bar">
            {slotLabels.map((label, i) => {
              const action = me.program[i];
              return (
                <button
                  key={label}
                  disabled={!canProgram || i > me.program.length || action?.type === 'SKIP'}
                  className={`${i === slot ? 'selected' : ''} ${action ? 'filled' : ''}`}
                  onClick={() => {
                    setEditing(i === me.program.length ? null : i);
                    setChosen(action?.card ?? null);
                  }}
                >
                  <small>{label}</small>
                  <span>{action ? ICONS[action.type] : '＋'}</span>
                  {action?.type === 'MOVE' && (
                    <small className="action-parameter">
                      {
                        {
                          UP: '↑',
                          UP_RIGHT: '↗',
                          RIGHT: '→',
                          DOWN_RIGHT: '↘',
                          DOWN: '↓',
                          DOWN_LEFT: '↙',
                          LEFT: '←',
                          UP_LEFT: '↖',
                        }[action.direction!]
                      }{' '}
                      {action.distance}
                    </small>
                  )}
                  <small>
                    {action?.type === 'SKIP' ? 'LOCKED' : action ? LABELS[action.type] : 'CHOOSE'}
                  </small>
                </button>
              );
            })}
          </div>
          {p.ready ? (
            <div className="ready-message">
              <span>✓</span>
              <h2>The plan is locked.</h2>
              <p>
                {s.players.filter((x) => x.ready).length} / {s.players.length} ready.
                <br />
                Watch the host screen when the movie starts.
              </p>
            </div>
          ) : (
            <>
              <div className="hand-heading">
                <h3>
                  {complete && editing === null
                    ? 'A beautiful disaster.'
                    : `Choose ${slotLabels[slot] ?? 'an action'}`}
                </h3>
                <span>
                  {me.deck.draw.length} draw · {me.deck.discard.length} discard
                </span>
              </div>
              {(!complete || editing !== null) && (
                <>
                  <div className="hand">
                    {cards.map((card) => (
                      <button
                        key={card.id}
                        className={`action-card card-${card.type} ${chosen?.id === card.id ? 'selected' : ''}`}
                        disabled={card.type.endsWith('JUNK')}
                        onClick={() => select(card)}
                      >
                        <span className="card-icon">{ICONS[card.type]}</span>
                        <strong>{LABELS[card.type]}</strong>
                        <small>
                          {card.type === 'MOVE'
                            ? '8 directions · 1–12 steps'
                            : card.type === 'SHOOT'
                              ? 'Clear sight · range 6'
                              : card.type === 'PUNCH'
                                ? 'Same square · knockback'
                                : card.type === 'STEAL_LOOT'
                                  ? 'Pocket one floor item'
                                  : card.type === 'GO_OTHER_ROOM'
                                    ? 'Head to an adjacent room'
                                    : 'JUNK · CANNOT BE PLAYED'}
                        </small>
                      </button>
                    ))}
                  </div>
                  <button
                    className="skip-button"
                    onClick={() => send('game.action.skip_draw', { slot, skip: true })}
                  >
                    <span>＋</span>
                    <div>
                      <strong>Skip & Draw</strong>
                      <small>Lock this slot. Draw a card right now.</small>
                    </div>
                    <span>↗</span>
                  </button>
                </>
              )}
              <button
                className="primary ready-button"
                disabled={!complete}
                onClick={() => send('game.player.ready')}
              >
                Ready for the chaos <span>✓</span>
              </button>
              {complete && (
                <p className="muted">Tap any normal action above to edit it before Ready.</p>
              )}
            </>
          )}
          <LootBag player={p} />
        </main>
      ) : (
        <main className="movie-controller">
          {me.target ? (
            <>
              <span className="eyebrow">YOU’RE UP, {p.name.toUpperCase()}</span>
              <h1>
                Pick your
                <br />
                <em>unlucky friend.</em>
              </h1>
              <Timer endsAt={me.target.endsAt} now={now} />
              <p>Only valid targets are shown. If time runs out, fate picks one.</p>
              <div className="target-grid">
                {me.target.candidates.map((id) => {
                  const target = s.players.find((x) => x.id === id)!;
                  return (
                    <button
                      key={id}
                      style={{ borderColor: target.color }}
                      onClick={() => send('game.target.select', { targetId: id })}
                    >
                      <Avatar avatar={target.avatar} color={target.color} size={72} />
                      <strong>{target.name}</strong>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <span className="eyebrow">ROUND {s.round.number} · ACTION MOVIE</span>
              <h1>
                Sit back.
                <br />
                <em>Plead innocence.</em>
              </h1>
              <p>
                The plan is in motion.
                <br />
                Eyes on the host screen.
              </p>
              <div className="emoji-grid">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => send('game.emoji.send', { emoji })}
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <span className="eyebrow">MAKE YOUR FEELINGS KNOWN.</span>
              <div className="movie-personal">
                <span>
                  Hits taken <b>{p.hitsReceived}</b>
                </span>
                <span>
                  Arrests <b>{p.arrests}</b>
                </span>
                <span>
                  Junk cards <b>{p.junk}</b>
                </span>
              </div>
            </>
          )}
        </main>
      )}
      {mapOpen && s.phase === 'ACTION_SELECTION' && (
        <div className="controller-map">
          <header>
            <strong>THE BANK · READ ONLY</strong>
            <button className="secondary" onClick={() => setMapOpen(false)}>
              Back to plan ×
            </button>
          </header>
          <BankMap state={s} now={now} inspect />
          <p>Scroll to pan. Use + and − to zoom. Tap loot or a character to inspect its label.</p>
        </div>
      )}
      {chosen && canProgram && (chosen.type === 'MOVE' || chosen.type === 'GO_OTHER_ROOM') && (
        <ActionPlanner
          key={`${chosen.id}-${slot}-${origin}`}
          card={chosen}
          player={p}
          origin={origin}
          initial={me.program[slot]}
          uncertain={Boolean(predictions[slot - 1]?.uncertain)}
          endsAt={s.phaseEndsAt}
          now={now}
          onConfirm={(params) => submit(chosen, params)}
          onClose={() => setChosen(null)}
        />
      )}
      {profileOpen && (s.phase === 'LOBBY' || s.phase === 'RESULTS') && (
        <div className="profile-editor" role="dialog" aria-modal="true" aria-label="Edit profile">
          <Join game={game} profile={p} onClose={() => setProfileOpen(false)} />
        </div>
      )}
    </div>
  );
}
