export const INFLUENCE_CARDS = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'] as const;
export type InfluenceCard = (typeof INFLUENCE_CARDS)[number];

export const ACTION_TYPES = ['income', 'foreign_aid', 'tax', 'steal', 'assassinate', 'coup', 'exchange'] as const;
export type GameActionType = (typeof ACTION_TYPES)[number];

export type BlockRole = 'duke' | 'captain' | 'ambassador' | 'contessa';
export type GameStatus = 'waiting' | 'active' | 'finished';

export interface InfluenceSlot {
  card: InfluenceCard;
  revealed: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  coins: number;
  influence: InfluenceSlot[];
}

export type PendingAfterInfluence =
  | { type: 'end_turn' }
  | { type: 'continue_action'; actorId: string; action: GameActionType; targetId?: string }
  | { type: 'resolve_action'; actorId: string; action: GameActionType; targetId?: string };

export interface InfluenceChoice {
  id: string;
  slotIndex: number;
  card: InfluenceCard;
}

export interface ExchangeOption {
  id: string;
  card: InfluenceCard;
}

export type PendingState =
  | {
      type: 'await_action_response';
      actorId: string;
      action: GameActionType;
      targetId?: string;
      claimRole: InfluenceCard;
      blockRoles: BlockRole[];
      pendingPlayerIds: string[];
    }
  | {
      type: 'await_action_challenge';
      actorId: string;
      action: GameActionType;
      targetId?: string;
      claimRole: InfluenceCard;
      pendingPlayerIds: string[];
    }
  | {
      type: 'await_block';
      actorId: string;
      action: GameActionType;
      targetId?: string;
      pendingPlayerIds: string[];
    }
  | {
      type: 'await_block_challenge';
      actorId: string;
      action: GameActionType;
      targetId?: string;
      blockerId: string;
      blockRole: BlockRole;
      pendingPlayerIds: string[];
    }
  | {
      type: 'await_influence';
      playerId: string;
      reason: string;
      choices: InfluenceChoice[];
      after: PendingAfterInfluence;
    }
  | {
      type: 'await_exchange';
      playerId: string;
      keepCount: number;
      options: ExchangeOption[];
      concealedSlotIndexes: number[];
      after: PendingAfterInfluence;
    };

export interface GameState {
  id: string;
  status: GameStatus;
  hostPlayerId: string;
  players: PlayerState[];
  turnIndex: number;
  deck: InfluenceCard[];
  winnerId: string | null;
  log: string[];
  pending: PendingState | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicPlayerState {
  id: string;
  name: string;
  connected: boolean;
  coins: number;
  revealedCards: InfluenceCard[];
  isAlive: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  cards: InfluenceCard[];
  revealedCards: InfluenceCard[];
}

export type PublicPendingState =
  | {
      type: 'await_action_response';
      actorId: string;
      action: GameActionType;
      targetId?: string;
      claimRole: InfluenceCard;
      blockRoles: BlockRole[];
      pendingPlayerIds: string[];
    }
  | {
      type: 'await_action_challenge';
      actorId: string;
      action: GameActionType;
      targetId?: string;
      claimRole: InfluenceCard;
      pendingPlayerIds: string[];
    }
  | {
      type: 'await_block';
      actorId: string;
      action: GameActionType;
      targetId?: string;
      pendingPlayerIds: string[];
    }
  | {
      type: 'await_block_challenge';
      actorId: string;
      action: GameActionType;
      targetId?: string;
      blockerId: string;
      blockRole: BlockRole;
      pendingPlayerIds: string[];
    }
  | {
      type: 'await_influence';
      playerId: string;
      reason: string;
      yourChoices: Array<Pick<InfluenceChoice, 'id' | 'card'>>;
    }
  | {
      type: 'await_exchange';
      playerId: string;
      keepCount: number;
      yourOptions: ExchangeOption[];
    };

export interface PublicGameState {
  id: string;
  status: GameStatus;
  hostPlayerId: string;
  players: PublicPlayerState[];
  currentTurnPlayerId: string | null;
  winnerId: string | null;
  log: string[];
  pending: PublicPendingState | null;
  you: PlayerView | null;
}

export type PlayerCommand =
  | { kind: 'action'; type: GameActionType; targetId?: string }
  | { kind: 'pass' }
  | { kind: 'challenge' }
  | { kind: 'block'; role?: BlockRole }
  | { kind: 'reveal'; choiceId: string }
  | { kind: 'exchange'; keepIds: string[] };

export interface ActionInput {
  playerId: string;
  command: PlayerCommand;
}
