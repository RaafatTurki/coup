import { broadcastGameResponse, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { takeAction } from '$lib/server/coup-store';
import { takeActionBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, takeActionBodySchema);
  const game = takeAction(requireGameId(params.gameId), {
    playerId: body.playerId,
    command: body.command
  });

  return broadcastGameResponse(game, body.playerId);
});
