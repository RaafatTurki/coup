import type { GameState } from '$lib/game/types';

const WAITING_GAME_TTL_MS = 3_600_000;
const FINISHED_GAME_TTL_MS = 7_200_000;
const SWEEP_INTERVAL_MS = 60_000;

type CleanupStore = {
  entries: () => IterableIterator<[string, GameState]>;
  delete: (gameId: string) => boolean;
};

const globalCleanup = globalThis as typeof globalThis & {
  __isSweeping?: boolean;
};

export function startGameSweep(store: CleanupStore): void {
  if (globalCleanup.__isSweeping) {
    return;
  }

  globalCleanup.__isSweeping = true;
  const sweepTimer = setInterval(() => {
    const now = Date.now();

    for (const [gameId, game] of store.entries()) {
      const ageMs = now - new Date(game.updatedAt).getTime();
      if (game.status === 'waiting' && ageMs > WAITING_GAME_TTL_MS) {
        store.delete(gameId);
        continue;
      }
      if (game.status === 'finished' && ageMs > FINISHED_GAME_TTL_MS) {
        store.delete(gameId);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}
