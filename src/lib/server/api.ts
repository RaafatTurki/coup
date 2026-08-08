import { json, type RequestHandler } from '@sveltejs/kit';
import type { GameState } from '$lib/game/types';
import { GameError } from '$lib/server/coup-store';
import { getPublicGameState } from '$lib/server/coup-public';
import { getConnectedPlayerIds } from '$lib/server/realtime';

export function gameErrorResponse(error: unknown) {
  if (error instanceof GameError) {
    return json({ error: error.message }, { status: error.status });
  }
  if (error instanceof SyntaxError) {
    return json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  console.error(error);
  return json({ error: 'Unexpected server error.' }, { status: 500 });
}

export function withGameErrorHandling(handler: RequestHandler) {
  return async (event: Parameters<RequestHandler>[0]) => {
    try {
      return await handler(event);
    } catch (error) {
      return gameErrorResponse(error);
    }
  };
}

export function publicGamePayload(game: GameState, viewerPlayerId?: string) {
  return {
    game: getPublicGameState(game, viewerPlayerId, getConnectedPlayerIds(game.id))
  };
}

export function requireGameId(gameId: string | undefined) {
  if (!gameId?.trim()) {
    throw new GameError('Game not found.', 404);
  }

  return gameId;
}
