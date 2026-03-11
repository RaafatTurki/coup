import { json } from '@sveltejs/kit';
import { createGameBodySchema } from '$lib/server/schemas';
import { publicGamePayload, withGameErrorHandling } from '$lib/server/api';
import { createGame } from '$lib/server/coup-store';
import { parseJsonBody } from '$lib/server/validation';
import { broadcastGameState } from '$lib/server/realtime';

export const POST = withGameErrorHandling(async ({ request }) => {
  const body = await parseJsonBody(request, createGameBodySchema);
  const { game, playerId } = createGame(body.name);
  broadcastGameState(game);

  return json({
    gameId: game.id,
    playerId,
    ...publicGamePayload(game, playerId)
  });
});
