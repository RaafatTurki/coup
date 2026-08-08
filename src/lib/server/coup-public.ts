import type {
  GameState,
  PendingState,
  PlayerState,
  PublicGameState,
  PublicPendingState
} from '$lib/game/types';

function remainingInfluence(player: PlayerState, gameStatus: GameState['status']): number {
  if (gameStatus === 'waiting') {
    return 2;
  }

  return player.influence.reduce((count, slot) => count + Number(!slot.revealed), 0);
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
        pendingPlayerIds: [...pending.pendingPlayerIds]
      };
    case 'await_action_challenge':
      return {
        type: pending.type,
        actorId: pending.actorId,
        action: pending.action,
        targetId: pending.targetId,
        claimRole: pending.claimRole,
        pendingPlayerIds: [...pending.pendingPlayerIds]
      };
    case 'await_block':
      return {
        type: pending.type,
        actorId: pending.actorId,
        action: pending.action,
        targetId: pending.targetId,
        pendingPlayerIds: [...pending.pendingPlayerIds]
      };
    case 'await_block_challenge':
      return {
        type: pending.type,
        actorId: pending.actorId,
        action: pending.action,
        targetId: pending.targetId,
        blockerId: pending.blockerId,
        blockRole: pending.blockRole,
        pendingPlayerIds: [...pending.pendingPlayerIds]
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
