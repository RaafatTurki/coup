import { json } from '@sveltejs/kit';
import { requireGameId, withGameErrorHandling } from '$lib/server/api';
import { leaveGame } from '$lib/server/coup-store';
import { broadcastGameState } from '$lib/server/realtime';
import { playerActionBodySchema } from '$lib/server/schemas';
import { parseJsonBody } from '$lib/server/validation';

export const POST = withGameErrorHandling(async ({ params, request }) => {
  const body = await parseJsonBody(request, playerActionBodySchema);
  const game = leaveGame(requireGameId(params.gameId), body.playerId);
  broadcastGameState(game);

  return json({ ok: true });
});
