import { createGameBodySchema } from '$lib/server/schemas';
import { broadcastGameResponse, withGameErrorHandling } from '$lib/server/api';
import { createGame } from '$lib/server/coup-store';
import { parseJsonBody } from '$lib/server/validation';

export const POST = withGameErrorHandling(async ({ request }) => {
  const body = await parseJsonBody(request, createGameBodySchema);
  const { game, playerId } = createGame(body.name);

  return broadcastGameResponse(game, playerId, { gameId: game.id, playerId });
});
