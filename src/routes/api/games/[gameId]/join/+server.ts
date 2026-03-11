import { json } from '@sveltejs/kit';
import { publicGamePayload, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { joinGame } from '$lib/server/coup-store';
import { joinGameBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';
import { broadcastGameState } from '$lib/server/realtime';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, joinGameBodySchema);
  const { game, playerId } = joinGame(requireGameId(params.gameId), body.name);
  broadcastGameState(game);

  return json({
    gameId: game.id,
    playerId,
    ...publicGamePayload(game, playerId)
  });
});
