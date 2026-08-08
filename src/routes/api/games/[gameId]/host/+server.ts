import { broadcastGameResponse, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { transferHost } from '$lib/server/coup-store';
import { hostTransferBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, hostTransferBodySchema);
  const game = transferHost(requireGameId(params.gameId), body.playerId, body.targetId);

  return broadcastGameResponse(game, body.playerId);
});
