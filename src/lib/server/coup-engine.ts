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
  type PlayerState
} from '$lib/game/types';
import { actionCost, canUseAction, mustCoup } from '$lib/game/rules';

const MAX_LOG_ENTRIES = 200;

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

type ResponsePending = Extract<PendingState, { pendingPlayerIds: string[] }>;

export class GameError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

export function appendLog(game: GameState, message: string): void {
  game.log.unshift(message);
  if (game.log.length > MAX_LOG_ENTRIES) {
    game.log.length = MAX_LOG_ENTRIES;
  }
}

export function makeId(): string {
  return globalThis.crypto.randomUUID();
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[next]] = [copy[next], copy[index]];
  }

  return copy;
}

export function createDeck(): InfluenceCard[] {
  const fullDeck: InfluenceCard[] = [];

  for (const card of INFLUENCE_CARDS) {
    fullDeck.push(card, card, card);
  }

  return shuffle(fullDeck);
}

export function isAlive(player: PlayerState): boolean {
  return player.influence.some((slot) => !slot.revealed);
}

function isBlockableAction(action: GameActionType): action is keyof typeof BLOCK_ROLES_BY_ACTION {
  return action in BLOCK_ROLES_BY_ACTION;
}

function alivePlayerIds(game: GameState): string[] {
  return game.players.filter((player) => isAlive(player)).map((player) => player.id);
}

export function getPlayerOrThrow(game: GameState, playerId: string): PlayerState {
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

function resetEmptyGame(game: GameState): void {
  game.status = 'waiting';
  game.hostPlayerId = '';
  game.turnIndex = 0;
  game.deck = [];
  game.winnerId = null;
  game.pending = null;
}

export function finalizeGameIfNeeded(game: GameState): void {
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
    if (shouldRevealAllInfluence(playerId, pending.after) && !isAlive(player)) {
      endTurn(game);
      return;
    }

    continueAfterInfluence(game, pending.after);
  }
}

function shouldRevealAllInfluence(playerId: string, after: PendingAfterInfluence): boolean {
  return after.type === 'resolve_action' && after.action === 'assassinate' && after.targetId === playerId;
}

function revealAllInfluence(game: GameState, player: PlayerState, choices: InfluenceChoice[], reason: string): void {
  for (const choice of choices) {
    const slot = player.influence[choice.slotIndex];
    if (!slot || slot.revealed) {
      continue;
    }

    slot.revealed = true;
    appendLog(game, `${player.name} reveals ${choice.card} (${reason}).`);
  }

  if (!isAlive(player)) {
    appendLog(game, `${player.name} is eliminated.`);
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

    choices.push({ id: makeId(), slotIndex: index, card: slot.card });
  }

  if (choices.length === 0) {
    throw new GameError(`${player.name} has no remaining influence.`);
  }

  if (choices.length > 1 && shouldRevealAllInfluence(playerId, after)) {
    revealAllInfluence(game, player, choices, `${reason}; assassinated`);
    game.pending = null;
    finalizeGameIfNeeded(game);
    if (game.status === 'active') {
      endTurn(game);
    }
    return;
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
    options.push({ id: makeId(), card: slot.card });
  }

  const drawCount = Math.min(2, game.deck.length);
  for (let index = 0; index < drawCount; index += 1) {
    const drawn = game.deck.pop();
    if (!drawn) {
      break;
    }
    options.push({ id: makeId(), card: drawn });
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
    pendingPlayerIds
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
    pendingPlayerIds
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
    pendingPlayerIds
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
    pendingPlayerIds: challengers
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

export function removePlayerAtIndex(
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

export function takeGameAction(game: GameState, input: ActionInput): void {
  if (game.status !== 'active') {
    throw new GameError('The game is not active.');
  }

  if (!game.pending) {
    if (input.command.kind !== 'action') {
      throw new GameError('You must declare an action on your turn.');
    }

    declareAction(game, input.playerId, input.command.type, input.command.targetId);
    return;
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
}
