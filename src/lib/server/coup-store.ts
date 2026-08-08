import { customAlphabet } from 'nanoid';
import type { ActionInput, GameState, PlayerState } from '$lib/game/types';
import { startGameSweep } from '$lib/server/coup-cleanup';
import {
  appendLog,
  createDeck,
  finalizeGameIfNeeded,
  GameError,
  getPlayerOrThrow,
  isAlive,
  makeId,
  removePlayerAtIndex,
  takeGameAction
} from '$lib/server/coup-engine';

export { GameError } from '$lib/server/coup-engine';

const MAX_PLAYERS = 6;
const MIN_PLAYERS_TO_START = 2;
const GAME_ID_LENGTH = 6;
const GAME_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeGameToken = customAlphabet(GAME_ID_ALPHABET, GAME_ID_LENGTH);

const games = new Map<string, GameState>();

function makeGameId(): string {
  let gameId: string;
  do {
    gameId = makeGameToken();
  } while (games.has(gameId));
  return gameId;
}

function nowIso(): string {
  return new Date().toISOString();
}

function updateTimestamp(game: GameState): void {
  game.updatedAt = nowIso();
}

function normalizeName(name: string): string {
  const cleanName = name.trim();
  if (!cleanName) {
    throw new GameError('Name is required.');
  }
  if (cleanName.length > 24) {
    throw new GameError('Name must be 24 characters or fewer.');
  }
  return cleanName;
}

function normalizeGameId(gameId: string): string {
  const normalized = gameId.trim().toUpperCase();
  if (!normalized) {
    throw new GameError('Game ID is required.');
  }
  return normalized;
}

function reconcileHostPlayer(game: GameState): void {
  if (game.players.length === 0) {
    game.hostPlayerId = '';
    return;
  }

  if (game.players.some((player) => player.id === game.hostPlayerId)) {
    return;
  }

  game.hostPlayerId = game.players[0].id;
}

function getGameOrThrow(gameId: string): GameState {
  const normalizedId = normalizeGameId(gameId);
  const game = games.get(normalizedId);

  if (!game) {
    throw new GameError('Game not found.', 404);
  }

  reconcileHostPlayer(game);
  return game;
}

export function createGame(hostName: string): { game: GameState; playerId: string } {
  const gameId = makeGameId();
  const playerId = makeId();
  const host: PlayerState = {
    id: playerId,
    name: normalizeName(hostName),
    coins: 2,
    influence: []
  };

  const timestamp = nowIso();
  const game: GameState = {
    id: gameId,
    status: 'waiting',
    hostPlayerId: playerId,
    players: [host],
    turnIndex: 0,
    deck: [],
    winnerId: null,
    log: [`${host.name} created the table.`],
    pending: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  games.set(game.id, game);
  return { game, playerId };
}

export function joinGame(gameId: string, playerName: string): { game: GameState; playerId: string } {
  const game = getGameOrThrow(gameId);

  if (game.status !== 'waiting') {
    throw new GameError('This game has already started.');
  }
  if (game.players.length >= MAX_PLAYERS) {
    throw new GameError('This game is full.');
  }

  const normalizedName = normalizeName(playerName);
  if (game.players.some((player) => player.name.toLowerCase() === normalizedName.toLowerCase())) {
    throw new GameError('That name is already taken in this game.');
  }

  const playerId = makeId();
  const noPlayersAtJoin = game.players.length === 0;

  game.players.push({
    id: playerId,
    name: normalizedName,
    coins: 2,
    influence: []
  });

  if (noPlayersAtJoin) {
    game.hostPlayerId = playerId;
    game.status = 'waiting';
    game.turnIndex = 0;
    game.deck = [];
    game.winnerId = null;
    game.pending = null;
    appendLog(game, `${normalizedName} joined and became the new host.`);
  } else {
    appendLog(game, `${normalizedName} joined the table.`);
  }

  updateTimestamp(game);

  return { game, playerId };
}

export function startGame(gameId: string, playerId: string): GameState {
  const game = getGameOrThrow(gameId);

  if (game.status !== 'waiting') {
    throw new GameError('Game has already started.');
  }
  if (game.hostPlayerId !== playerId) {
    throw new GameError('Only the host can start the game.', 403);
  }
  if (game.players.length < MIN_PLAYERS_TO_START) {
    throw new GameError(`At least ${MIN_PLAYERS_TO_START} players are required.`);
  }

  game.deck = createDeck();

  for (const player of game.players) {
    player.coins = 2;
    player.influence = [
      { card: game.deck.pop()!, revealed: false },
      { card: game.deck.pop()!, revealed: false }
    ];
  }

  game.status = 'active';
  game.pending = null;
  game.turnIndex = Math.floor(Math.random() * game.players.length);
  appendLog(game, 'The game has started.');
  appendLog(game, `${game.players[game.turnIndex].name} takes the first turn.`);
  updateTimestamp(game);

  return game;
}

export function resetGame(gameId: string, playerId: string): GameState {
  const game = getGameOrThrow(gameId);

  if (game.hostPlayerId !== playerId) {
    throw new GameError('Only the host can reset the game.', 403);
  }

  const host = getPlayerOrThrow(game, playerId);
  const hostIndex = game.players.findIndex((player) => player.id === game.hostPlayerId);

  game.status = 'waiting';
  game.turnIndex = hostIndex >= 0 ? hostIndex : 0;
  game.deck = [];
  game.winnerId = null;
  game.pending = null;

  for (const player of game.players) {
    player.coins = 2;
    player.influence = [];
  }

  game.log = [];
  appendLog(game, `${host.name} reset the game.`);
  updateTimestamp(game);

  return game;
}

export function transferHost(gameId: string, playerId: string, targetId: string): GameState {
  const game = getGameOrThrow(gameId);

  if (game.hostPlayerId !== playerId) {
    throw new GameError('Only the host can transfer host privileges.', 403);
  }
  if (playerId === targetId) {
    throw new GameError('You are already the host.');
  }

  const currentHost = getPlayerOrThrow(game, playerId);
  const target = getPlayerOrThrow(game, targetId);
  if (game.status === 'active' && !isAlive(target)) {
    throw new GameError('Cannot transfer host to an eliminated player.');
  }

  game.hostPlayerId = target.id;
  appendLog(game, `${currentHost.name} transferred host to ${target.name}.`);
  updateTimestamp(game);
  return game;
}

export function kickPlayer(gameId: string, playerId: string, targetId: string): GameState {
  const game = getGameOrThrow(gameId);

  if (game.hostPlayerId !== playerId) {
    throw new GameError('Only the host can kick players.', 403);
  }
  if (playerId === targetId) {
    throw new GameError('Host cannot kick themselves.');
  }

  const host = getPlayerOrThrow(game, playerId);
  const targetIndex = game.players.findIndex((player) => player.id === targetId);
  if (targetIndex < 0) {
    throw new GameError('Target player not found.', 404);
  }
  const target = game.players[targetIndex];

  removePlayerAtIndex(
    game,
    targetIndex,
    `${target.name} was kicked by ${host.name}.`,
    'Pending interaction was cleared because a player was removed from the table.'
  );
  if (game.status === 'active') {
    finalizeGameIfNeeded(game);
  }

  updateTimestamp(game);
  return game;
}

export function leaveGame(gameId: string, playerId: string): GameState {
  const game = getGameOrThrow(gameId);

  const playerIndex = game.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    throw new GameError('Player not found in this game.', 404);
  }

  const player = game.players[playerIndex];
  removePlayerAtIndex(game, playerIndex, `${player.name} left the table.`);

  if (game.players.length === 0) {
    appendLog(game, 'The table is empty and ready for new players.');
  } else if (game.status === 'active') {
    finalizeGameIfNeeded(game);
  }

  updateTimestamp(game);
  return game;
}

export function takeAction(gameId: string, input: ActionInput): GameState {
  const game = getGameOrThrow(gameId);
  takeGameAction(game, input);
  updateTimestamp(game);
  return game;
}

export function getGame(gameId: string): GameState {
  return getGameOrThrow(gameId);
}

export function assertPlayerInGame(gameId: string, playerId: string): void {
  getPlayerOrThrow(getGameOrThrow(gameId), playerId);
}

void startGameSweep({
  entries: () => games.entries(),
  delete: (gameId) => games.delete(gameId)
});
