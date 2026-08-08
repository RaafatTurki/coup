import { broadcastGameResponse, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { joinGame } from '$lib/server/coup-store';
import { joinGameBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, joinGameBodySchema);
  const { game, playerId } = joinGame(requireGameId(params.gameId), body.name);

  return broadcastGameResponse(game, playerId, { gameId: game.id, playerId });
});
