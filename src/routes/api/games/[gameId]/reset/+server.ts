import { json } from '@sveltejs/kit';
import { publicGamePayload, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { resetGame } from '$lib/server/coup-store';
import { playerActionBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';
import { broadcastGameState } from '$lib/server/realtime';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, playerActionBodySchema);
  const game = resetGame(requireGameId(params.gameId), body.playerId);
  broadcastGameState(game);

  return json(publicGamePayload(game, body.playerId));
});
