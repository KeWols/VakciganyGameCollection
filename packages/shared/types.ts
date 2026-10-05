import type { ActionType, Direction, DEFAULT_SETTINGS } from './config';
export type GameSettings = typeof DEFAULT_SETTINGS;
export type CardKind = ActionType | 'HIT_JUNK' | 'SHERIFF_JUNK';
export interface Card {
  id: string;
  type: CardKind;
}
export interface PlayerDeck {
  draw: Card[];
  hand: Card[];
  discard: Card[];
}
export interface ProgrammedAction {
  type: ActionType | 'SKIP';
  card?: Card;
  direction?: Direction;
  distance?: number;
  destinationRoomId?: string;
  /** Derived by the server; an estimate, never an authoritative destination. */
  predictNextMove?: string;
}
export interface LootItem {
  id: string;
  kind: number;
  squareId: string;
}
export interface PlayerState {
  id: string;
  token: string;
  name: string;
  avatar: string;
  color: string;
  squareId: string;
  loot: LootItem[];
  hitsDealt: number;
  shots: number;
  hitsReceived: number;
  arrests: number;
  junk: number;
  deck: PlayerDeck;
  program: ProgrammedAction[];
  ready: boolean;
  connected: boolean;
  reshuffleUntil: number;
  lastEmojiAt: number;
}
export interface MiniActionPhase {
  index: number;
  repeatCount: 1 | 2;
}
export interface ActionRound {
  number: number;
  order: string[];
  phases: MiniActionPhase[];
}
export interface TargetSelectionState {
  playerId: string;
  candidates: string[];
  endsAt: number;
}
export interface MovieStep {
  playerId: string;
  phase: number;
  repeat: number;
  slot: number;
}
export interface WheelState {
  id: string;
  title: string;
  entries: { id: string; label: string }[];
  winnerId: string;
  endsAt: number;
}
export interface Motion {
  id: string;
  actorId: string;
  points: { x: number; y: number }[];
  startedAt: number;
  duration: number;
  kind: string;
}
export interface Effect {
  id: string;
  kind: string;
  actorId: string;
  targetId?: string;
  text: string;
  at: number;
}
export interface GameState {
  phase: 'LOBBY' | 'ACTION_SELECTION' | 'ACTION_MOVIE' | 'RESULTS';
  settings: GameSettings;
  players: PlayerState[];
  loot: LootItem[];
  sheriffSquareId: string;
  round: ActionRound;
  phaseStartedAt: number;
  phaseEndsAt: number;
  current: MovieStep | null;
  target: TargetSelectionState | null;
  wheel: WheelState | null;
  motions: Motion[];
  effect: Effect | null;
  log: string[];
}
export type PublicPlayer = Omit<
  PlayerState,
  'token' | 'deck' | 'program' | 'reshuffleUntil' | 'lastEmojiAt'
> & { programmedCount: number; lootValue: number; score: number };
export type PublicState = Omit<GameState, 'players' | 'target'> & {
  players: PublicPlayer[];
  target: { playerId: string; endsAt: number } | null;
};
export interface PrivateState {
  deck: PlayerDeck;
  program: ProgrammedAction[];
  reshuffleUntil: number;
  target: TargetSelectionState | null;
}
export interface Snapshot {
  state: PublicState;
  me: PrivateState | null;
  playerId: string | null;
  serverTime: number;
  broker: string;
}
export interface Command {
  connectionId: string;
  type: string;
  payload: unknown;
}
export interface Envelope {
  type: string;
  payload: unknown;
  serverTime: number;
}
