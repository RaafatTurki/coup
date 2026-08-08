import { publicGameResponse, requireGameId, withGameErrorHandling } from '$lib/server/api';
import { getGameQuerySchema } from '$lib/server/schemas';
import { getGame } from '$lib/server/coup-store';
import { parseSearchParams } from '$lib/server/validation';

export const GET = withGameErrorHandling(({ params, url }) => {
  const query = parseSearchParams(url, getGameQuerySchema);
  const game = getGame(requireGameId(params.gameId));
  return publicGameResponse(game, query.playerId);
});
