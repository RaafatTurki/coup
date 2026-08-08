import { broadcastGameResponse, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { kickPlayer } from '$lib/server/coup-store';
import { kickPlayerBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, kickPlayerBodySchema);
  const game = kickPlayer(requireGameId(params.gameId), body.playerId, body.targetId);

  return broadcastGameResponse(game, body.playerId);
});
