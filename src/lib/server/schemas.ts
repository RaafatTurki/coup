import { z } from 'zod';
import { ACTION_TYPES } from '$lib/game/types';

const nameSchema = z.string().trim().min(1, 'Name is required.').max(24, 'Name must be 24 characters or fewer.');
const playerIdSchema = z.string().trim().min(1, 'Player ID is required.');
const targetIdSchema = z.string().trim().min(1, 'Target ID is required.');
const blockRoleSchema = z.enum(['duke', 'captain', 'ambassador', 'contessa']);

const commandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    type: z.enum(ACTION_TYPES),
    targetId: targetIdSchema.optional()
  }),
  z.object({ kind: z.literal('pass') }),
  z.object({ kind: z.literal('challenge') }),
  z.object({ kind: z.literal('block'), role: blockRoleSchema.optional() }),
  z.object({ kind: z.literal('reveal'), choiceId: z.string().trim().min(1, 'Choose a card to reveal.') }),
  z.object({
    kind: z.literal('exchange'),
    keepIds: z.array(z.string().trim().min(1)).min(1, 'Choose cards to keep.')
  })
]);

export const createGameBodySchema = z.object({
  name: nameSchema
});

export const joinGameBodySchema = z.object({
  name: nameSchema
});

export const playerActionBodySchema = z.object({
  playerId: playerIdSchema
});

export const hostTransferBodySchema = z.object({
  playerId: playerIdSchema,
  targetId: targetIdSchema
});

export const kickPlayerBodySchema = z.object({
  playerId: playerIdSchema,
  targetId: targetIdSchema
});

export const takeActionBodySchema = z.object({
  playerId: playerIdSchema,
  command: commandSchema
});

export const getGameQuerySchema = z.object({
  playerId: playerIdSchema.optional()
});
