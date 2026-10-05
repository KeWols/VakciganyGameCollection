export const ACTIONS = ['MOVE', 'GO_OTHER_ROOM', 'SHOOT', 'STEAL_LOOT', 'PUNCH'] as const;
export type ActionType = (typeof ACTIONS)[number];
export const LABELS: Record<string, string> = {
  MOVE: 'Move',
  GO_OTHER_ROOM: 'Change rooms',
  SHOOT: 'Shoot',
  STEAL_LOOT: 'Steal loot',
  PUNCH: 'Punch',
  SKIP: 'Skip & draw',
  HIT_JUNK: 'Bullet hole',
  SHERIFF_JUNK: 'Arrest record',
};
export const ICONS: Record<string, string> = {
  MOVE: '↗',
  GO_OTHER_ROOM: '⇥',
  SHOOT: '⌖',
  STEAL_LOOT: '◆',
  PUNCH: '✊',
  SKIP: '＋',
  HIT_JUNK: '◉',
  SHERIFF_JUNK: '▤',
};
export const PALETTE = [
  '#E6194B',
  '#3CB44B',
  '#FFE119',
  '#4363D8',
  '#F58231',
  '#911EB4',
  '#42D4F4',
  '#F032E6',
  '#BFEF45',
  '#FABED4',
  '#469990',
  '#DCBEFF',
  '#9A6324',
  '#FFFAC8',
  '#800000',
  '#AAFFC3',
  '#808000',
  '#000075',
  '#A9A9A9',
  '#000000',
];
export const AVATARS = [
  '🦊',
  '🐼',
  '🐸',
  '🐯',
  '🐙',
  '🐺',
  '🐰',
  '🐵',
  '🦝',
  '🐱',
  '🦉',
  '🐻',
  '🦁',
  '🐨',
  '🐷',
  '🦄',
  '🐲',
  '🐧',
  '🐶',
  '🦋',
];
export const EMOJIS = ['😂', '😡', '😱', '💀', '🔥', '🤡', '👏', '❤️'];
export const DIRECTIONS = {
  UP: [0, -1],
  UP_RIGHT: [1, -1],
  RIGHT: [1, 0],
  DOWN_RIGHT: [1, 1],
  DOWN: [0, 1],
  DOWN_LEFT: [-1, 1],
  LEFT: [-1, 0],
  UP_LEFT: [-1, -1],
} as const;
export type Direction = keyof typeof DIRECTIONS;
export const LOOT = [
  { name: 'Cash bundle', value: 500, icon: '▰' },
  { name: 'Money bag', value: 1000, icon: '💰' },
  { name: 'Jewelry', value: 1500, icon: '◈' },
  { name: 'Gold bar', value: 2000, icon: '▱' },
  { name: 'Bearer bonds', value: 2500, icon: '▤' },
  { name: 'Diamond', value: 3000, icon: '💎' },
];
export const LIMITS = {
  rounds: [1, 20],
  selectionSeconds: [10, 180],
  targetSeconds: [3, 30],
  lootCount: [1, 120],
  deckCount: [0, 30],
} as const;
export const DEFAULT_SETTINGS = {
  rounds: 8,
  selectionSeconds: 60,
  targetSeconds: 10,
  lootCount: 24,
  deck: { MOVE: 4, GO_OTHER_ROOM: 1, SHOOT: 2, STEAL_LOOT: 2, PUNCH: 2 },
};
export const BALANCE = {
  maxPlayers: 20,
  shootRange: 6,
  maxMove: 12,
  maxPunch: 2,
  successfulHitBonus: 250,
  receivedHitPenalty: 1000,
  reshuffleMs: 3000,
};
export const TIMING = {
  action: 850,
  movement: 900,
  wheel: 1800,
  round: 1800,
  emoji: 2400,
};
export function foreground(hex: string) {
  const c = hex
    .slice(1)
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722 > 0.179 ? '#101613' : '#ffffff';
}
