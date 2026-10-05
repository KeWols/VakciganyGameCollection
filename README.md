# Midnight Withdrawal

A playable, server-authoritative party heist for one host screen and up to 20 phone controllers. Program actions first; watch the plans collide in the Action Movie.

## Start with RabbitMQ

Requirements: Node.js 20.19+ (22+ recommended), npm, Docker Desktop with its Linux engine running. From this project directory:

```powershell
docker compose up -d --wait
npm install
npm run dev
```

- Host: **http://localhost:5173/host**
- Player: **http://localhost:5173/player**
- On phones connected to the same Wi-Fi, use **http://YOUR_COMPUTER_LAN_IP:5173/player**. The host lobby displays the detected LAN link. Choose your Wi-Fi address if a VPN or virtual adapter is detected first.
- Frontend: port **5173**. Backend/WebSocket gateway: port **3001**. Vite proxies `/ws` and `/api`.
- RabbitMQ: port **5672**; local management dashboard: **http://localhost:15672**, default `guest` / `guest`. Broker ports bind only to localhost.

To launch frontend/backend separately, use `npm run dev:server` and `npm run dev:client` in two terminals after RabbitMQ is healthy. Windows may request local-network permission for Node when phones first connect.

The default transport **requires RabbitMQ**. It never silently falls back. If Docker is unavailable, explicitly opt into the development transport:

```powershell
$env:BROKER = 'memory'
npm run dev
```

To return to RabbitMQ in that terminal, stop the dev server, run `Remove-Item Env:BROKER`, then `npm run dev`.

For a production-style local build:

```powershell
npm run build
npm start
```

The server serves the compiled frontend at **http://localhost:3001/host** and **/player**. The `.env.example` file documents supported environment variables; set them in your shell (it is not loaded automatically). Optional `HOST_KEY` restricts host initialization. Without it, anyone on the local network can open the host, appropriate for a trusted party prototype.

## Play

1. Open `/host` on the shared screen. Each person opens `/player`, chooses an alias and preset avatar, or uploads/takes a photo. Photos have a circular crop editor and are resized locally before upload.
2. Configure rounds, selection/target timers, loot count and each action-card quantity. Start when the crew has joined.
3. Controllers fill action slots in order. Doubled phases have A/B slots. Select Move direction/distance or an adjacent room as needed. Normal slots can be edited until Ready. Skip & Draw permanently locks its slot and draws immediately.
4. During planning, inspect/pan/zoom the map. Ready requires every slot. The server fills unfinished programs when the timer expires, including disconnected players.
5. The host plays the movie. Doubles execute consecutively **for each player**, then the Sheriff moves twice. Controllers show reactions, temporarily replaced by eligible-target choices when needed.
6. Loot is the primary score. Hits dealt add $250; hits received subtract $1,000. Nobody is eliminated. Results include loot, successful shots, hits, arrests and junk counts.

Reloading the controller restores its player through a localStorage token. Use separate browser profiles/devices to test different players. A controller and host can share one browser. Server state is in memory: **restarting the server starts a fresh lobby**; page reload/reconnection does not restart the game.

## Rules implemented

- Twelve main rooms (nine logical squares each), two safe Holding Rooms on opposite sides of the bank, connecting corridors, wall geometry, door adjacency, continuous animation and balanced N-region stacking up to 20. Logical-square boundaries are faintly visible; subregion boundaries remain hidden.
- Minimum-occupancy random spawning, excluding the vault and Holding; valuable vault loot, no inventory limit.
- Personal draw/hand/program/discard piles; retained unused hands; discard recycling; base-phase-count + 1 starting hand; three-second optional hand/deck reshuffle; permanent distinct Hit/Sheriff junk cards.
- Random 3–6 phases, 25% double probability per eligible phase, cap of two doubles, random player order each round.
- Fixed-direction Move 1–12 stopping at walls; Chebyshev-range-6 Shoot with geometry raycast and player blocking; same-square Punch, wall-safe knockback up to two, empty-landing preference and one-item loot drop.
- Execution-time targeting; a single target resolves automatically, several targets prompt the acting controller, and timeout selects uniformly using the reusable host wheel. Steal and punch loot wheels contain actual items only.
- Sheriff moves uniformly to neighboring rooms after each phase, arrests every robber in its room, scatters all carried loot, adds Sheriff junk, and transfers prisoners to whichever Holding Room is farthest from the Sheriff by shortest walkable route (random tie-break). Neither Holding Room allows Sheriff punishment, including loot loss or junk. Ordinary movement and room travel can escape.
- Server timers, random results, validation, stats, scoring and state authority. The controller does not decide outcomes. Private hands/programs/target requests are sent only to their owner; host receives public state.

Explicit implementation decisions where the brief leaves a detail open:

- Corridors are walkable logical cells **outside** each room's nine cells. Their room association is fixed in the map definition for occupancy/arrest calculations.
- Move and Go Other Room open a phone-sized planning dialog with a temporary map, exact predicted square, path and arrival marker. Each later action starts from the preceding actions' estimate. The server independently recomputes and stores `predictNextMove`; client predictions never override actual positions.
- Room choices are validated against the predicted origin during programming. If a programmed room is no longer adjacent at execution, use the current room's only exit automatically, or a uniform host random wheel when multiple exits exist. Predictions ignore future opponents/Sheriff interference and flag ambiguous earlier fallback choices. Editing an earlier action recomputes all downstream estimates.
- Punch counts as a successful hit dealt/received for end-game scoring; only Shoot adds Hit Junk and increments successful-shot statistics.
- Initial Sheriff placement is in the vault, keeping initial player spawns safe. A moving robber is intercepted at the first entry into the Sheriff's room.
- Shared-square assignments use stable player-ID ordering in a balanced equal-area partition. Re-layout animates smoothly as occupancy changes.

## Architecture

`React → WebSocket gateway → RabbitMQ game.commands → Engine → RabbitMQ game.events → gateway → clients`

The engine consumes one exclusive command queue with prefetch 1. Movie execution is an asynchronous ordered loop; target decisions and cosmetic reactions can arrive while that loop is waiting. Both broker implementations expose the same boundary. RabbitMQ events include a destination connection ID; the gateway never sends another player's private snapshot to a client.

- `packages/shared`: strict domain models, map geometry and centralized balance/settings/action definitions.
- `apps/server/src/rules.ts`: testable randomization, decks, geometry queries, spawn, arrest and scoring services.
- `apps/server/src/engine.ts`: session state, validated command handlers and sequential action resolution.
- `apps/server/src/actions.ts`: reusable action-handler registry with an explicit engine context.
- `packages/shared/prediction.ts`: pure planning estimates shared by controller previews and server validation.
- `apps/server/src/broker.ts`: RabbitMQ exchanges, single-consumer queue and explicit development broker.
- `apps/server/src/index.ts`: Express, WebSocket gateway, heartbeat, input size/rate limits, cached portraits and static serving.
- `apps/client/src`: host, mobile controller, animated map, reusable wheels/results and reconnecting client.

All balance values and animation durations live in `packages/shared/config.ts`. The map definition owns logical coordinates and world geometry; React only interpolates authoritative destinations. Actions are a typed set resolved independently of the UI, leaving room for future abilities without implementing them now.

## Validate

```powershell
npm run typecheck
npm test
npm run build
npm run test:smoke
# With RabbitMQ running:
npm run test:rabbit
```

The unit suite covers critical engine rules and server-command validation. The end-to-end smoke test starts an isolated server on port 3019 and joins 20 actual WebSocket controllers, checks colors/privacy, programs every slot, reconnects a controller and completes a game. It uses accelerated movie animation (`MOVIE_SPEED=0.01`) only on the isolated test server; normal playback defaults to 1. Do not run the Rabbit smoke test alongside a live Rabbit-backed game: the single-session exclusive queue intentionally rejects a second engine.

The browser flow is designed for touch, dynamic mobile viewport heights and iOS/Android file capture. Real camera capture requires a device/browser supporting `capture="user"`; on desktops the selfie input falls back to a file picker. Native Safari/device-camera testing requires those devices. Font loading is optional; system sans-serif fallbacks keep the game functional offline.

## Prototype limits

One active session, no accounts, no database/persistent match recovery, no matchmaking and no character abilities. Disconnects preserve players for reconnection and server timeouts keep the match progressing. The supplied request did not include the referenced character image, so characters implement its written circular-portrait/cartoon-arms concept. Docker/RabbitMQ must be available for the default transport.

## Lobby and display updates

- Players can edit their name and preset/uploaded/selfie picture in the pregame lobby and after results. Identity, color and reconnect token stay unchanged; updated photos receive a new cached URL version.
- Only a host connection can kick a player, and only in the pregame lobby. Kick clears all current sessions for that identity and revokes its reconnect token. It is removal, not an IP ban: the person can join again as a new player. Vacated colors are safely reused without duplicating another player's color.
- The host fills the screen without scrolling, with a wide bank map, a compact crew panel accommodating 20 players, a bottom control strip and a compact results list. Use a landscape TV/desktop browser (1280×720 or larger recommended).
- The controller's **Inspect map** button has a dedicated map icon. Player colors also appear on the identity ribbon, card/slot accents, reactions, planner and confirmation button.
