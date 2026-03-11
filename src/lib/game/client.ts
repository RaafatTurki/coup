const PLAYER_KEY_PREFIX = 'coup:player:';

const playerStorageKey = (gameId: string) => `${PLAYER_KEY_PREFIX}${gameId}`;
const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function normalizeGameId(value: string) {
  return value.trim().toUpperCase();
}

export function rememberPlayer(gameId: string, playerId: string) {
  storage()?.setItem(playerStorageKey(gameId), playerId);
}

export function readStoredPlayer(gameId: string) {
  return storage()?.getItem(playerStorageKey(gameId)) ?? '';
}

export function clearStoredPlayer(gameId: string) {
  storage()?.removeItem(playerStorageKey(gameId));
}
