import { json } from '@sveltejs/kit';
import { publicGamePayload, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { transferHost } from '$lib/server/coup-store';
import { hostTransferBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';
import { broadcastGameState } from '$lib/server/realtime';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, hostTransferBodySchema);
  const game = transferHost(requireGameId(params.gameId), body.playerId, body.targetId);
  broadcastGameState(game);

  return json(publicGamePayload(game, body.playerId));
});
