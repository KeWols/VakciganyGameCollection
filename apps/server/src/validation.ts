import { z } from 'zod';
import { ACTIONS, AVATARS, DIRECTIONS, EMOJIS, LIMITS } from '../../../packages/shared/config';
const integer = (range: readonly [number, number]) => z.number().int().min(range[0]).max(range[1]);
export const settingsSchema = z
  .object({
    rounds: integer(LIMITS.rounds),
    selectionSeconds: integer(LIMITS.selectionSeconds),
    targetSeconds: integer(LIMITS.targetSeconds),
    lootCount: integer(LIMITS.lootCount),
    deck: z.object({
      MOVE: integer(LIMITS.deckCount),
      GO_OTHER_ROOM: integer(LIMITS.deckCount),
      SHOOT: integer(LIMITS.deckCount),
      STEAL_LOOT: integer(LIMITS.deckCount),
      PUNCH: integer(LIMITS.deckCount),
    }),
  })
  .strict()
  .refine((s) => ACTIONS.some((a) => s.deck[a] > 0), 'At least one usable action card is required');
const avatar = z
  .string()
  .max(180000)
  .refine(
    (s) => AVATARS.includes(s) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s),
    'Choose an avatar or a small image',
  );
export const joinSchema = z.object({ name: z.string().trim().min(1).max(24), avatar }).strict();
export const profileSchema = z
  .object({ name: z.string().trim().min(1).max(24), avatar: avatar.optional() })
  .strict();
export const kickSchema = z.object({ playerId: z.string().max(100) }).strict();
export const programSchema = z
  .object({
    slot: z.number().int().min(0).max(7),
    cardId: z.string().max(100).optional(),
    skip: z.boolean().optional(),
    direction: z
      .enum(Object.keys(DIRECTIONS) as [keyof typeof DIRECTIONS, ...(keyof typeof DIRECTIONS)[]])
      .optional(),
    distance: z.number().int().min(1).max(12).optional(),
    destinationRoomId: z.string().max(30).optional(),
  })
  .strict();
export const targetSchema = z.object({ targetId: z.string().max(100) }).strict();
export const emojiSchema = z.object({ emoji: z.enum(EMOJIS as [string, ...string[]]) }).strict();
export const helloSchema = z
  .object({
    role: z.enum(['host', 'player']),
    token: z.string().max(100).optional(),
    hostKey: z.string().max(200).optional(),
  })
  .strict();
