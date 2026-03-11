import type { GameActionType, GameStatus } from '$lib/game/types';

export const FORCED_COUP_COINS = 10;
export const ASSASSINATE_COST = 3;
export const COUP_COST = 7;

export function mustCoup(coins: number): boolean {
  return coins >= FORCED_COUP_COINS;
}

export function actionNeedsTarget(action: GameActionType): boolean {
  return action === 'steal' || action === 'assassinate' || action === 'coup';
}

export function actionCost(action: GameActionType): number {
  if (action === 'assassinate') {
    return ASSASSINATE_COST;
  }
  if (action === 'coup') {
    return COUP_COST;
  }
  return 0;
}

export function canUseAction(action: GameActionType, coins: number, status: GameStatus): boolean {
  if (status !== 'active') {
    return false;
  }

  if (mustCoup(coins) && action !== 'coup') {
    return false;
  }

  return coins >= actionCost(action);
}
