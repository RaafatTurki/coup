import { broadcastGameResponse, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { startGame } from '$lib/server/coup-store';
import { playerActionBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, playerActionBodySchema);
  const game = startGame(requireGameId(params.gameId), body.playerId);

  return broadcastGameResponse(game, body.playerId);
});
