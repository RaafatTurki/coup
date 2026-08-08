import {
  ACTION_TYPES,
  INFLUENCE_CARDS,
  type ActionInput,
  type BlockRole,
  type ExchangeOption,
  type GameActionType,
  type GameState,
  type InfluenceCard,
  type InfluenceChoice,
  type PendingAfterInfluence,
  type PendingState,
  type PlayerState,
  type PublicGameState,
  type PublicPendingState
} from '$lib/game/types';
import { actionCost, canUseAction, mustCoup } from '$lib/game/rules';

const MAX_PLAYERS = 6;
const MIN_PLAYERS_TO_START = 2;
const GAME_ID_LENGTH = 6;
const GAME_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_LOG_ENTRIES = 200;
const WAITING_GAME_TTL_MS = 3_600_000;
const FINISHED_GAME_TTL_MS = 7_200_000;
const SWEEP_INTERVAL_MS = 60_000;

const ACTION_CLAIMS: Partial<Record<GameActionType, InfluenceCard>> = {
  tax: 'duke',
  steal: 'captain',
  assassinate: 'assassin',
  exchange: 'ambassador'
};

const BLOCK_ROLES_BY_ACTION: Record<'foreign_aid' | 'steal' | 'assassinate', BlockRole[]> = {
  foreign_aid: ['duke'],
  steal: ['captain', 'ambassador'],
  assassinate: ['contessa']
};
type ResponsePending = Extract<
  PendingState,
  { pendingPlayerIds: string[]; passedPlayerIds: string[] }
>;

const games = new Map<string, GameState>();
const globalStore = globalThis as typeof globalThis & {
  __coupGameSweepStarted?: boolean;
};

export class GameError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

function startGameSweep(): void {
  if (globalStore.__coupGameSweepStarted) {
    return;
  }

  globalStore.__coupGameSweepStarted = true;
  const sweepTimer = setInterval(() => {
    const now = nowMs();
    for (const [gameId, game] of games.entries()) {
      const ageMs = now - new Date(game.updatedAt).getTime();
      if (game.status === 'waiting' && ageMs > WAITING_GAME_TTL_MS) {
        games.delete(gameId);
        continue;
      }
      if (game.status === 'finished' && ageMs > FINISHED_GAME_TTL_MS) {
        games.delete(gameId);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

function appendLog(game: GameState, message: string): void {
  game.log.unshift(message);
  if (game.log.length > MAX_LOG_ENTRIES) {
    game.log.length = MAX_LOG_ENTRIES;
  }
}

function makePlayerId(): string {
  return globalThis.crypto.randomUUID();
}

function makeChoiceId(): string {
  return globalThis.crypto.randomUUID();
}

function makeGameId(): string {
  let gameId = '';

  do {
    gameId = Array.from({ length: GAME_ID_LENGTH }, () => {
      const index = Math.floor(Math.random() * GAME_ID_ALPHABET.length);
      return GAME_ID_ALPHABET[index];
    }).join('');
  } while (games.has(gameId));

  return gameId;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nowMs(): number {
  return Date.now();
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

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[next]] = [copy[next], copy[index]];
  }

  return copy;
}

function createDeck(): InfluenceCard[] {
  const fullDeck: InfluenceCard[] = [];

  for (const card of INFLUENCE_CARDS) {
    fullDeck.push(card, card, card);
  }

  return shuffle(fullDeck);
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

function isAlive(player: PlayerState): boolean {
  return player.influence.some((slot) => !slot.revealed);
}

function isBlockableAction(action: GameActionType): action is keyof typeof BLOCK_ROLES_BY_ACTION {
  return action in BLOCK_ROLES_BY_ACTION;
}

function alivePlayerIds(game: GameState): string[] {
  return game.players.filter((player) => isAlive(player)).map((player) => player.id);
}

function remainingInfluence(player: PlayerState, gameStatus: GameState['status']): number {
  if (gameStatus === 'waiting') {
    return 2;
  }

  return player.influence.reduce((count, slot) => count + Number(!slot.revealed), 0);
}

function getPlayerOrThrow(game: GameState, playerId: string): PlayerState {
  const player = game.players.find((entry) => entry.id === playerId);
  if (!player) {
    throw new GameError('Player not found in this game.', 404);
  }
  return player;
}

function ensureTarget(game: GameState, actorId: string, targetId?: string): PlayerState {
  if (!targetId) {
    throw new GameError('Target is required for this action.');
  }

  const target = getPlayerOrThrow(game, targetId);
  if (target.id === actorId) {
    throw new GameError('You cannot target yourself.');
  }
  if (!isAlive(target)) {
    throw new GameError('Target is already eliminated.');
  }

  return target;
}

function advanceTurn(game: GameState): void {
  for (let offset = 1; offset <= game.players.length; offset += 1) {
    const nextIndex = (game.turnIndex + offset) % game.players.length;
    if (isAlive(game.players[nextIndex])) {
      game.turnIndex = nextIndex;
      return;
    }
  }
}

function updateTimestamp(game: GameState): void {
  game.updatedAt = nowIso();
}

function resetEmptyGame(game: GameState): void {
  game.status = 'waiting';
  game.hostPlayerId = '';
  game.turnIndex = 0;
  game.deck = [];
  game.winnerId = null;
  game.pending = null;
}

function finalizeGameIfNeeded(game: GameState): void {
  const alivePlayers = game.players.filter((player) => isAlive(player));

  if (alivePlayers.length === 1) {
    game.status = 'finished';
    game.winnerId = alivePlayers[0].id;
    game.turnIndex = game.players.findIndex((player) => player.id === alivePlayers[0].id);
    game.pending = null;
    appendLog(game, `${alivePlayers[0].name} wins the game.`);
  }
}

function endTurn(game: GameState): void {
  if (game.status !== 'active') {
    return;
  }

  game.pending = null;
  advanceTurn(game);
  appendLog(game, `It is now ${game.players[game.turnIndex].name}'s turn.`);
}

function playerHasClaim(player: PlayerState, role: InfluenceCard): boolean {
  return player.influence.some((slot) => !slot.revealed && slot.card === role);
}

function swapProvenCardWithDeck(game: GameState, player: PlayerState, role: InfluenceCard): void {
  const slot = player.influence.find((entry) => !entry.revealed && entry.card === role);
  if (!slot) {
    throw new GameError(`${player.name} cannot prove ${role}.`);
  }

  game.deck.push(slot.card);
  game.deck = shuffle(game.deck);
  const replacement = game.deck.pop();
  if (!replacement) {
    throw new GameError('Deck is empty.');
  }

  slot.card = replacement;
  slot.revealed = false;
}

function continueAfterInfluence(game: GameState, after: PendingAfterInfluence): void {
  if (game.status !== 'active') {
    return;
  }

  if (after.type === 'end_turn') {
    endTurn(game);
    return;
  }

  if (after.type === 'continue_action') {
    continueDeclaredAction(game, after.actorId, after.action, after.targetId);
    return;
  }

  resolveDeclaredAction(game, after.actorId, after.action, after.targetId);
}

function resolveInfluenceChoice(game: GameState, playerId: string, choiceId: string): void {
  if (!game.pending || game.pending.type !== 'await_influence') {
    throw new GameError('No influence reveal is pending.');
  }
  if (game.pending.playerId !== playerId) {
    throw new GameError('It is not your reveal decision.', 403);
  }

  const pending = game.pending;
  const choice = pending.choices.find((entry) => entry.id === choiceId);
  if (!choice) {
    throw new GameError('Invalid reveal choice.');
  }

  const player = getPlayerOrThrow(game, playerId);
  const slot = player.influence[choice.slotIndex];
  if (!slot || slot.revealed) {
    throw new GameError('That card can no longer be revealed.');
  }

  slot.revealed = true;
  game.pending = null;

  appendLog(game, `${player.name} reveals ${choice.card} (${pending.reason}).`);
  if (!isAlive(player)) {
    appendLog(game, `${player.name} is eliminated.`);
  }

  finalizeGameIfNeeded(game);
  if (game.status === 'active') {
    continueAfterInfluence(game, pending.after);
  }
}

function queueInfluenceLoss(game: GameState, playerId: string, reason: string, after: PendingAfterInfluence): void {
  const player = getPlayerOrThrow(game, playerId);
  const choices: InfluenceChoice[] = [];

  for (let index = 0; index < player.influence.length; index += 1) {
    const slot = player.influence[index];
    if (slot.revealed) {
      continue;
    }

    choices.push({ id: makeChoiceId(), slotIndex: index, card: slot.card });
  }

  if (choices.length === 0) {
    throw new GameError(`${player.name} has no remaining influence.`);
  }

  game.pending = {
    type: 'await_influence',
    playerId,
    reason,
    choices,
    after
  };

  appendLog(game, `${player.name} must reveal an influence card.`);
  if (choices.length === 1) {
    resolveInfluenceChoice(game, playerId, choices[0].id);
  }
}

function beginExchangeChoice(game: GameState, actorId: string): void {
  const actor = getPlayerOrThrow(game, actorId);
  const concealedSlotIndexes: number[] = [];
  const options: ExchangeOption[] = [];

  for (let index = 0; index < actor.influence.length; index += 1) {
    const slot = actor.influence[index];
    if (slot.revealed) {
      continue;
    }
    concealedSlotIndexes.push(index);
    options.push({ id: makeChoiceId(), card: slot.card });
  }

  const drawCount = Math.min(2, game.deck.length);
  for (let index = 0; index < drawCount; index += 1) {
    const drawn = game.deck.pop();
    if (!drawn) {
      break;
    }
    options.push({ id: makeChoiceId(), card: drawn });
  }

  const keepCount = concealedSlotIndexes.length;
  if (options.length < keepCount) {
    throw new GameError('Not enough cards available to exchange.');
  }

  game.pending = {
    type: 'await_exchange',
    playerId: actorId,
    keepCount,
    options,
    concealedSlotIndexes,
    after: { type: 'end_turn' }
  };

  appendLog(game, `${actor.name} draws cards to exchange influence.`);

  if (options.length === keepCount) {
    resolveExchangeChoice(game, actorId, options.map((option) => option.id));
  }
}

function resolveExchangeChoice(game: GameState, playerId: string, keepIds: string[]): void {
  if (!game.pending || game.pending.type !== 'await_exchange') {
    throw new GameError('No exchange is pending.');
  }
  if (game.pending.playerId !== playerId) {
    throw new GameError('It is not your exchange decision.', 403);
  }

  const pending = game.pending;
  const uniqueIds = Array.from(new Set(keepIds));
  if (uniqueIds.length !== pending.keepCount) {
    throw new GameError(`Choose exactly ${pending.keepCount} card(s) to keep.`);
  }

  const selected = uniqueIds.map((id) => pending.options.find((option) => option.id === id));
  if (selected.some((entry) => !entry)) {
    throw new GameError('Invalid exchange selection.');
  }

  const selectedCards = selected.map((entry) => entry!.card);
  const selectedSet = new Set(uniqueIds);
  const returnedCards = pending.options
    .filter((option) => !selectedSet.has(option.id))
    .map((option) => option.card);

  const player = getPlayerOrThrow(game, playerId);
  pending.concealedSlotIndexes.forEach((slotIndex, index) => {
    player.influence[slotIndex].card = selectedCards[index];
    player.influence[slotIndex].revealed = false;
  });

  game.deck.push(...returnedCards);
  game.deck = shuffle(game.deck);

  game.pending = null;
  appendLog(game, `${player.name} finishes exchanging influence.`);
  continueAfterInfluence(game, pending.after);
}

function beginActionChallenge(
  game: GameState,
  actorId: string,
  action: GameActionType,
  targetId: string | undefined,
  claimRole: InfluenceCard
): void {
  const pendingPlayerIds =
    (action === 'steal' || action === 'assassinate') && targetId
      ? alivePlayerIds(game).filter((playerId) => playerId === targetId)
      : alivePlayerIds(game).filter((playerId) => playerId !== actorId);

  if (pendingPlayerIds.length === 0) {
    continueDeclaredAction(game, actorId, action, targetId);
    return;
  }

  game.pending = {
    type: 'await_action_challenge',
    actorId,
    action,
    targetId,
    claimRole,
    pendingPlayerIds,
    passedPlayerIds: []
  };

  const actor = getPlayerOrThrow(game, actorId);
  if (pendingPlayerIds.length === 1) {
    appendLog(game, `${actor.name} claims ${claimRole}. ${getPlayerOrThrow(game, pendingPlayerIds[0]).name} may challenge.`);
    return;
  }

  appendLog(game, `${actor.name} claims ${claimRole}. Players may challenge.`);
}

function beginActionResponse(
  game: GameState,
  actorId: string,
  action: 'steal' | 'assassinate',
  targetId: string,
  claimRole: InfluenceCard
): void {
  const pendingPlayerIds = alivePlayerIds(game).filter((playerId) => playerId === targetId);

  if (pendingPlayerIds.length === 0) {
    resolveDeclaredAction(game, actorId, action, targetId);
    return;
  }

  game.pending = {
    type: 'await_action_response',
    actorId,
    action,
    targetId,
    claimRole,
    blockRoles: [...BLOCK_ROLES_BY_ACTION[action]],
    pendingPlayerIds,
    passedPlayerIds: []
  };

  const actor = getPlayerOrThrow(game, actorId);
  const responder = getPlayerOrThrow(game, targetId);
  appendLog(game, `${actor.name} claims ${claimRole}. ${responder.name} may challenge, block, or pass.`);
}

function beginBlockWindow(game: GameState, actorId: string, action: GameActionType, targetId?: string): void {
  if (!isBlockableAction(action)) {
    resolveDeclaredAction(game, actorId, action, targetId);
    return;
  }

  const pendingPlayerIds =
    action === 'foreign_aid'
      ? alivePlayerIds(game).filter((playerId) => playerId !== actorId)
      : targetId
        ? alivePlayerIds(game).filter((playerId) => playerId === targetId)
        : [];

  if (pendingPlayerIds.length === 0) {
    resolveDeclaredAction(game, actorId, action, targetId);
    return;
  }

  game.pending = {
    type: 'await_block',
    actorId,
    action,
    targetId,
    pendingPlayerIds,
    passedPlayerIds: []
  };

  appendLog(game, `Players may block ${action.replace('_', ' ')}.`);
}

function continueDeclaredAction(game: GameState, actorId: string, action: GameActionType, targetId?: string): void {
  if (action === 'foreign_aid' || isBlockableAction(action)) {
    beginBlockWindow(game, actorId, action, targetId);
    return;
  }

  resolveDeclaredAction(game, actorId, action, targetId);
}

function resolveDeclaredAction(game: GameState, actorId: string, action: GameActionType, targetId?: string): void {
  const actor = getPlayerOrThrow(game, actorId);

  if (!isAlive(actor)) {
    endTurn(game);
    return;
  }

  game.pending = null;

  switch (action) {
    case 'income': {
      actor.coins += 1;
      appendLog(game, `${actor.name} takes Income (+1 coin).`);
      endTurn(game);
      break;
    }
    case 'foreign_aid': {
      actor.coins += 2;
      appendLog(game, `${actor.name} takes Foreign Aid (+2 coins).`);
      endTurn(game);
      break;
    }
    case 'tax': {
      actor.coins += 3;
      appendLog(game, `${actor.name} takes Tax (+3 coins).`);
      endTurn(game);
      break;
    }
    case 'steal': {
      const target = ensureTarget(game, actor.id, targetId);
      const stolen = Math.min(2, target.coins);
      target.coins -= stolen;
      actor.coins += stolen;
      appendLog(game, `${actor.name} steals ${stolen} coin(s) from ${target.name}.`);
      endTurn(game);
      break;
    }
    case 'assassinate': {
      const target = ensureTarget(game, actor.id, targetId);
      appendLog(game, `${actor.name} assassinates ${target.name}.`);
      queueInfluenceLoss(game, target.id, `assassinated by ${actor.name}`, { type: 'end_turn' });
      break;
    }
    case 'coup': {
      const target = ensureTarget(game, actor.id, targetId);
      appendLog(game, `${actor.name} coups ${target.name}.`);
      queueInfluenceLoss(game, target.id, `couped by ${actor.name}`, { type: 'end_turn' });
      break;
    }
    case 'exchange': {
      beginExchangeChoice(game, actor.id);
      break;
    }
  }
}

function resolveClaimChallenge(
  game: GameState,
  challengerId: string,
  challengedPlayerId: string,
  claimRole: InfluenceCard,
  onTruth: PendingAfterInfluence,
  onLie: PendingAfterInfluence
): void {
  const challenger = getPlayerOrThrow(game, challengerId);
  const challenged = getPlayerOrThrow(game, challengedPlayerId);

  if (!isAlive(challenger)) {
    throw new GameError('Eliminated players cannot challenge.');
  }
  if (!isAlive(challenged)) {
    throw new GameError('That player is already eliminated.');
  }

  if (playerHasClaim(challenged, claimRole)) {
    swapProvenCardWithDeck(game, challenged, claimRole);
    appendLog(game, `${challenger.name} challenges ${challenged.name} and loses.`);
    queueInfluenceLoss(game, challenger.id, 'failed challenge', onTruth);
    return;
  }

  appendLog(game, `${challenger.name} successfully challenges ${challenged.name}.`);
  queueInfluenceLoss(game, challenged.id, 'failed to prove claim', onLie);
}

function removePendingResponder(pending: ResponsePending, playerId: string): void {
  pending.pendingPlayerIds = pending.pendingPlayerIds.filter((id) => id !== playerId);
  if (!pending.passedPlayerIds.includes(playerId)) {
    pending.passedPlayerIds.push(playerId);
  }
}

function requireActiveTurn(game: GameState, playerId: string): PlayerState {
  if (game.status !== 'active') {
    throw new GameError('The game is not active.');
  }

  const actor = getPlayerOrThrow(game, playerId);
  if (!isAlive(actor)) {
    throw new GameError('Eliminated players cannot act.');
  }

  const currentPlayerId = game.players[game.turnIndex]?.id;
  if (currentPlayerId !== playerId) {
    throw new GameError('It is not your turn.');
  }

  return actor;
}

function declareAction(game: GameState, playerId: string, action: GameActionType, targetId?: string): void {
  const actor = requireActiveTurn(game, playerId);

  if (!ACTION_TYPES.includes(action)) {
    throw new GameError('Unknown action type.');
  }
  if (!canUseAction(action, actor.coins, game.status)) {
    throw new GameError('You cannot use that action right now.');
  }
  if (mustCoup(actor.coins) && action !== 'coup') {
    throw new GameError('You must coup when you have 10 or more coins.');
  }

  if (action === 'steal' || action === 'assassinate' || action === 'coup') {
    ensureTarget(game, actor.id, targetId);
  }

  const cost = actionCost(action);
  if (cost > 0) {
    if (actor.coins < cost) {
      throw new GameError(`${action[0].toUpperCase() + action.slice(1)} costs ${cost} coins.`);
    }
    actor.coins -= cost;
  }

  if (action === 'income' || action === 'coup') {
    resolveDeclaredAction(game, actor.id, action, targetId);
    return;
  }

  if (action === 'foreign_aid') {
    appendLog(game, `${actor.name} attempts Foreign Aid.`);
    beginBlockWindow(game, actor.id, action, targetId);
    return;
  }

  const claimRole = ACTION_CLAIMS[action];
  if (!claimRole) {
    throw new GameError('Action claim is undefined.');
  }

  if (action === 'steal') {
    const target = ensureTarget(game, actor.id, targetId);
    appendLog(game, `${actor.name} attempts to steal from ${target.name}.`);
    beginActionResponse(game, actor.id, action, target.id, claimRole);
    return;
  } else if (action === 'assassinate') {
    const target = ensureTarget(game, actor.id, targetId);
    appendLog(game, `${actor.name} attempts to assassinate ${target.name}.`);
    beginActionResponse(game, actor.id, action, target.id, claimRole);
    return;
  } else if (action === 'exchange') {
    appendLog(game, `${actor.name} attempts Exchange.`);
  } else if (action === 'tax') {
    appendLog(game, `${actor.name} attempts Tax.`);
  }

  beginActionChallenge(game, actor.id, action, targetId, claimRole);
}

function handlePendingActionResponse(game: GameState, input: ActionInput): void {
  if (!game.pending || game.pending.type !== 'await_action_response') {
    throw new GameError('No action response is pending.');
  }

  const pending = game.pending;
  if (!pending.pendingPlayerIds.includes(input.playerId)) {
    throw new GameError('You cannot respond at this time.', 403);
  }

  if (input.command.kind === 'pass') {
    removePendingResponder(pending, input.playerId);
    if (pending.pendingPlayerIds.length === 0) {
      resolveDeclaredAction(game, pending.actorId, pending.action, pending.targetId);
    }
    return;
  }

  if (input.command.kind === 'challenge') {
    game.pending = null;
    resolveClaimChallenge(
      game,
      input.playerId,
      pending.actorId,
      pending.claimRole,
      { type: 'resolve_action', actorId: pending.actorId, action: pending.action, targetId: pending.targetId },
      { type: 'end_turn' }
    );
    return;
  }

  if (input.command.kind === 'block') {
    const selectedRole =
      input.command.role && pending.blockRoles.includes(input.command.role)
        ? input.command.role
        : pending.blockRoles.length === 1
          ? pending.blockRoles[0]
          : null;

    if (!selectedRole) {
      throw new GameError('Choose a valid blocking role.');
    }

    beginBlockChallenge(game, pending.actorId, pending.action, pending.targetId, input.playerId, selectedRole);
    return;
  }

  throw new GameError('Use challenge, block, or pass right now.');
}

function handlePendingActionChallenge(game: GameState, input: ActionInput): void {
  if (!game.pending || game.pending.type !== 'await_action_challenge') {
    throw new GameError('No action challenge is pending.');
  }

  const pending = game.pending;
  if (!pending.pendingPlayerIds.includes(input.playerId)) {
    throw new GameError('You cannot respond at this time.', 403);
  }

  if (input.command.kind === 'pass') {
    removePendingResponder(pending, input.playerId);
    if (pending.pendingPlayerIds.length === 0) {
      continueDeclaredAction(game, pending.actorId, pending.action, pending.targetId);
    }
    return;
  }

  if (input.command.kind === 'challenge') {
    game.pending = null;
    resolveClaimChallenge(
      game,
      input.playerId,
      pending.actorId,
      pending.claimRole,
      { type: 'continue_action', actorId: pending.actorId, action: pending.action, targetId: pending.targetId },
      { type: 'end_turn' }
    );
    return;
  }

  throw new GameError('Use pass or challenge right now.');
}

function beginBlockChallenge(
  game: GameState,
  actorId: string,
  action: GameActionType,
  targetId: string | undefined,
  blockerId: string,
  blockRole: BlockRole
): void {
  const blocker = getPlayerOrThrow(game, blockerId);
  const challengers = alivePlayerIds(game).filter((playerId) => playerId === actorId);

  if (challengers.length === 0) {
    appendLog(game, `${blocker.name} blocks with ${blockRole}.`);
    appendLog(game, `${action.replace('_', ' ')} is blocked.`);
    endTurn(game);
    return;
  }

  game.pending = {
    type: 'await_block_challenge',
    actorId,
    action,
    targetId,
    blockerId: blocker.id,
    blockRole,
    pendingPlayerIds: challengers,
    passedPlayerIds: []
  };

  if (challengers.length === 1) {
    appendLog(game, `${blocker.name} blocks with ${blockRole}. ${getPlayerOrThrow(game, challengers[0]).name} may challenge.`);
    return;
  }

  appendLog(game, `${blocker.name} blocks with ${blockRole}. Players may challenge.`);
}

function handlePendingBlock(game: GameState, input: ActionInput): void {
  if (!game.pending || game.pending.type !== 'await_block') {
    throw new GameError('No block is pending.');
  }

  const pending = game.pending;
  if (!pending.pendingPlayerIds.includes(input.playerId)) {
    throw new GameError('You cannot respond at this time.', 403);
  }

  if (input.command.kind === 'pass') {
    removePendingResponder(pending, input.playerId);
    if (pending.pendingPlayerIds.length === 0) {
      resolveDeclaredAction(game, pending.actorId, pending.action, pending.targetId);
    }
    return;
  }

  if (input.command.kind === 'block') {
    if (!isBlockableAction(pending.action)) {
      throw new GameError('This action cannot be blocked.');
    }

    const roles = BLOCK_ROLES_BY_ACTION[pending.action];
    const selectedRole =
      input.command.role && roles.includes(input.command.role)
        ? input.command.role
        : roles.length === 1
          ? roles[0]
          : null;

    if (!selectedRole) {
      throw new GameError('Choose a valid blocking role.');
    }

    beginBlockChallenge(game, pending.actorId, pending.action, pending.targetId, input.playerId, selectedRole);
    return;
  }

  throw new GameError('Use pass or block right now.');
}

function handlePendingBlockChallenge(game: GameState, input: ActionInput): void {
  if (!game.pending || game.pending.type !== 'await_block_challenge') {
    throw new GameError('No block challenge is pending.');
  }

  const pending = game.pending;
  if (!pending.pendingPlayerIds.includes(input.playerId)) {
    throw new GameError('You cannot respond at this time.', 403);
  }

  if (input.command.kind === 'pass') {
    removePendingResponder(pending, input.playerId);
    if (pending.pendingPlayerIds.length === 0) {
      appendLog(game, `${pending.action.replace('_', ' ')} is blocked.`);
      endTurn(game);
    }
    return;
  }

  if (input.command.kind === 'challenge') {
    game.pending = null;
    resolveClaimChallenge(
      game,
      input.playerId,
      pending.blockerId,
      pending.blockRole,
      { type: 'end_turn' },
      { type: 'resolve_action', actorId: pending.actorId, action: pending.action, targetId: pending.targetId }
    );
    return;
  }

  throw new GameError('Use pass or challenge right now.');
}

function handlePendingInfluence(game: GameState, input: ActionInput): void {
  if (!game.pending || game.pending.type !== 'await_influence') {
    throw new GameError('No reveal is pending.');
  }

  if (input.command.kind !== 'reveal') {
    throw new GameError('Choose a card to reveal.');
  }

  resolveInfluenceChoice(game, input.playerId, input.command.choiceId);
}

function handlePendingExchange(game: GameState, input: ActionInput): void {
  if (!game.pending || game.pending.type !== 'await_exchange') {
    throw new GameError('No exchange is pending.');
  }

  if (input.command.kind !== 'exchange') {
    throw new GameError('Choose cards to keep.');
  }

  resolveExchangeChoice(game, input.playerId, input.command.keepIds);
}

function removePlayerAtIndex(
  game: GameState,
  playerIndex: number,
  removalMessage: string,
  pendingClearedMessage = 'Pending interaction was cleared because a player left the table.'
): void {
  const removedPlayer = game.players[playerIndex];
  const removedCurrentPlayer = game.status === 'active' && game.turnIndex === playerIndex;

  game.players.splice(playerIndex, 1);
  appendLog(game, removalMessage);

  if (game.pending) {
    game.pending = null;
    appendLog(game, pendingClearedMessage);
  }

  if (game.players.length === 0) {
    resetEmptyGame(game);
    return;
  }

  if (game.hostPlayerId === removedPlayer.id) {
    game.hostPlayerId = game.players[0].id;
    appendLog(game, `${game.players[0].name} is now the host.`);
  }

  if (playerIndex < game.turnIndex) {
    game.turnIndex -= 1;
  }

  if (removedCurrentPlayer && game.status === 'active') {
    game.turnIndex = (playerIndex - 1 + game.players.length) % game.players.length;
    advanceTurn(game);
    return;
  }

  if (game.turnIndex >= game.players.length) {
    game.turnIndex = 0;
  }

  if (game.status === 'finished' && game.winnerId === removedPlayer.id) {
    const nextWinner = game.players.find((player) => isAlive(player));
    game.winnerId = nextWinner?.id ?? null;
    if (game.winnerId) {
      game.turnIndex = game.players.findIndex((player) => player.id === game.winnerId);
    }
  }
}

export function createGame(hostName: string): { game: GameState; playerId: string } {
  const gameId = makeGameId();
  const playerId = makePlayerId();
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

  const playerId = makePlayerId();
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

  if (game.status !== 'active') {
    throw new GameError('The game is not active.');
  }

  if (!game.pending) {
    if (input.command.kind !== 'action') {
      throw new GameError('You must declare an action on your turn.');
    }

    declareAction(game, input.playerId, input.command.type, input.command.targetId);
    updateTimestamp(game);
    return game;
  }

  switch (game.pending.type) {
    case 'await_action_response':
      handlePendingActionResponse(game, input);
      break;
    case 'await_action_challenge':
      handlePendingActionChallenge(game, input);
      break;
    case 'await_block':
      handlePendingBlock(game, input);
      break;
    case 'await_block_challenge':
      handlePendingBlockChallenge(game, input);
      break;
    case 'await_influence':
      handlePendingInfluence(game, input);
      break;
    case 'await_exchange':
      handlePendingExchange(game, input);
      break;
  }

  updateTimestamp(game);
  return game;
}

export function getGame(gameId: string): GameState {
  return getGameOrThrow(gameId);
}

export function heartbeatPlayer(gameId: string, playerId: string): { game: GameState; changed: boolean } {
  const game = getGameOrThrow(gameId);
  getPlayerOrThrow(game, playerId);
  return { game, changed: false };
}

function toPublicPending(pending: PendingState | null, viewerPlayerId: string | undefined): PublicPendingState | null {
  if (!pending) {
    return null;
  }

  switch (pending.type) {
    case 'await_action_response':
      return {
        type: pending.type,
        actorId: pending.actorId,
        action: pending.action,
        targetId: pending.targetId,
        claimRole: pending.claimRole,
        blockRoles: [...pending.blockRoles],
        pendingPlayerIds: [...pending.pendingPlayerIds],
        passedPlayerIds: [...pending.passedPlayerIds]
      };
    case 'await_action_challenge':
      return {
        type: pending.type,
        actorId: pending.actorId,
        action: pending.action,
        targetId: pending.targetId,
        claimRole: pending.claimRole,
        pendingPlayerIds: [...pending.pendingPlayerIds],
        passedPlayerIds: [...pending.passedPlayerIds]
      };
    case 'await_block':
      return {
        type: pending.type,
        actorId: pending.actorId,
        action: pending.action,
        targetId: pending.targetId,
        pendingPlayerIds: [...pending.pendingPlayerIds],
        passedPlayerIds: [...pending.passedPlayerIds]
      };
    case 'await_block_challenge':
      return {
        type: pending.type,
        actorId: pending.actorId,
        action: pending.action,
        targetId: pending.targetId,
        blockerId: pending.blockerId,
        blockRole: pending.blockRole,
        pendingPlayerIds: [...pending.pendingPlayerIds],
        passedPlayerIds: [...pending.passedPlayerIds]
      };
    case 'await_influence':
      return {
        type: pending.type,
        playerId: pending.playerId,
        reason: pending.reason,
        yourChoices:
          viewerPlayerId === pending.playerId
            ? pending.choices.map((choice) => ({ id: choice.id, card: choice.card }))
            : []
      };
    case 'await_exchange':
      return {
        type: pending.type,
        playerId: pending.playerId,
        keepCount: pending.keepCount,
        yourOptions: viewerPlayerId === pending.playerId ? pending.options.map((option) => ({ ...option })) : []
      };
  }
}

export function getPublicGameState(
  game: GameState,
  viewerPlayerId?: string,
  connectedPlayerIds: ReadonlySet<string> = new Set()
): PublicGameState {
  reconcileHostPlayer(game);
  const viewer = viewerPlayerId ? game.players.find((player) => player.id === viewerPlayerId) : undefined;
  const currentTurn = game.status === 'active' || game.status === 'finished' ? game.players[game.turnIndex] : null;

  return {
    id: game.id,
    status: game.status,
    hostPlayerId: game.hostPlayerId,
    players: game.players.map((player) => {
      const remaining = remainingInfluence(player, game.status);
      return {
        id: player.id,
        name: player.name,
        connected: connectedPlayerIds.has(player.id),
        coins: player.coins,
        remainingInfluence: remaining,
        revealedCards: game.status === 'waiting' ? [] : player.influence.filter((card) => card.revealed).map((card) => card.card),
        isAlive: game.status === 'waiting' ? true : remaining > 0
      };
    }),
    currentTurnPlayerId: currentTurn?.id ?? null,
    winnerId: game.winnerId,
    log: [...game.log],
    pending: toPublicPending(game.pending, viewerPlayerId),
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    you: viewer
      ? {
          id: viewer.id,
          name: viewer.name,
          cards: viewer.influence.filter((card) => !card.revealed).map((card) => card.card),
          revealedCards: viewer.influence.filter((card) => card.revealed).map((card) => card.card)
        }
      : null
  };
}

void startGameSweep();
