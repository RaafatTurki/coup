<script lang="ts">
import { goto } from '$app/navigation';
import { Copy, LogOut } from 'lucide-svelte';
import { onMount } from 'svelte';
import {
  ACTION_TYPES,
  type BlockRole,
  type GameActionType,
  type InfluenceCard,
  type PlayerCommand,
  type PublicGameState
} from '$lib/game/types';
import { actionNeedsTarget as actionRequiresTarget, canUseAction as canUseGameAction } from '$lib/game/rules';
import { clearStoredPlayer, readStoredPlayer, rememberPlayer } from '$lib/game/client';
import { createRealtimeClient, type RealtimeClient } from '$lib/game/realtime';
import { messageFromError, requestJson } from '$lib/game/http';
import CardSpotlight from '$lib/components/CardSpotlight.svelte';
import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
import GamePlayersList from '$lib/components/GamePlayersList.svelte';

type PageData = { gameId: string };
type GamePayload = { game: PublicGameState };
type JoinPayload = GamePayload & { playerId: string };
type Confirmation =
  | { kind: 'leave'; title: string; message: string; confirmLabel: string }
  | { kind: 'reset'; title: string; message: string; confirmLabel: string }
  | { kind: 'transfer'; title: string; message: string; confirmLabel: string; targetId: string }
  | { kind: 'kick'; title: string; message: string; confirmLabel: string; targetId: string };

let { data } = $props<{ data: PageData }>();

let game = $state<PublicGameState | null>(null);
let playerId = $state('');
let joinName = $state('');
let errorMessage = $state('');
let joinPending = $state(false);
let startPending = $state(false);
let resetPending = $state(false);
let actionPending = $state(false);
let leavePending = $state(false);
let tableCodeCopied = $state(false);
let selectedAction = $state<GameActionType>('income');
let selectedTargetId = $state('');
let selectedBlockRole = $state<BlockRole>('captain');
let selectedExchangeKeepIds = $state<string[]>([]);
let exchangeSelectionKey = $state('');
let confirmation = $state<Confirmation | null>(null);
let spotlightCard = $state<InfluenceCard | null>(null);

let realtimeClient: RealtimeClient | null = null;
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

const ACTION_LABEL: Record<GameActionType, string> = {
  income: 'Income',
  foreign_aid: 'Aid',
  tax: 'Tax',
  steal: 'Steal',
  assassinate: 'Assassinate',
  coup: 'Coup',
  exchange: 'Exchange'
};

const me = $derived(game?.players.find((player) => player.id === playerId) ?? null);
const you = $derived(game?.you ?? null);
const pending = $derived(game?.pending ?? null);
const isHost = $derived(Boolean(game && playerId && game.hostPlayerId === playerId));
const isYourTurn = $derived(Boolean(game && game.status === 'active' && game.currentTurnPlayerId === playerId));
const targetablePlayers = $derived((game?.players ?? []).filter((player) => player.id !== playerId && player.isAlive));
const actionNeedsTarget = $derived(actionRequiresTarget(selectedAction));
const currentTurnName = $derived(
  game?.players.find((player) => player.id === game?.currentTurnPlayerId)?.name ?? '-'
);

function playerNameById(id: string | undefined): string {
  if (!id) {
    return '-';
  }
  return game?.players.find((player) => player.id === id)?.name ?? id;
}

function previewCard(card: InfluenceCard): void {
  spotlightCard = card;
}

function closeCardSpotlight(): void {
  spotlightCard = null;
}

function canUseAction(action: GameActionType): boolean {
  if (!game || !me) {
    return false;
  }

  return canUseGameAction(action, me.coins, game.status);
}

function post<T>(path: string, body: unknown, fallbackError: string): Promise<T> {
  return requestJson<T>(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    },
    fallbackError
  );
}

function isCurrentViewerSnapshot(snapshotPlayerId: string | undefined): boolean {
  return (snapshotPlayerId ?? '') === playerId;
}

function applyGameState(nextGame: PublicGameState, snapshotPlayerId?: string): void {
  if (!isCurrentViewerSnapshot(snapshotPlayerId)) {
    return;
  }

  game = nextGame;
  if (playerId && !nextGame.you) {
    clearStoredPlayer(data.gameId);
    playerId = '';
    errorMessage = 'You were disconnected from this table.';
    return;
  }

  errorMessage = '';
}

async function refreshGame(): Promise<void> {
  try {
    const requestPlayerId = playerId;
    const query = requestPlayerId ? `?playerId=${encodeURIComponent(requestPlayerId)}` : '';
    const payload = await requestJson<GamePayload>(`/api/games/${data.gameId}${query}`, undefined, 'Unable to load game.');
    applyGameState(payload.game, requestPlayerId || undefined);
  } catch (error) {
    errorMessage = messageFromError(error, 'Unable to load game.');
  }
}

async function joinGame(): Promise<void> {
  errorMessage = '';
  joinPending = true;
  try {
    const payload = await post<JoinPayload>(
      `/api/games/${data.gameId}/join`,
      { name: joinName },
      'Unable to join game.'
    );
    playerId = payload.playerId;
    rememberPlayer(data.gameId, payload.playerId);
    realtimeClient?.subscribe(payload.playerId);
    joinName = '';
    applyGameState(payload.game, payload.playerId);
  } catch (error) {
    errorMessage = messageFromError(error, 'Unable to join game.');
  } finally {
    joinPending = false;
  }
}

async function copyGameId(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(data.gameId);
    } else if (typeof document !== 'undefined') {
      const input = document.createElement('textarea');
      input.value = data.gameId;
      input.setAttribute('readonly', '');
      input.style.position = 'absolute';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      input.setSelectionRange(0, input.value.length);
      const copied = document.execCommand('copy');
      document.body.removeChild(input);

      if (!copied) {
        throw new Error('execCommand copy failed');
      }
    } else {
      throw new Error('clipboard unavailable');
    }

    errorMessage = '';
    tableCodeCopied = true;
    if (copyFeedbackTimer) {
      clearTimeout(copyFeedbackTimer);
    }
    copyFeedbackTimer = setTimeout(() => {
      tableCodeCopied = false;
      copyFeedbackTimer = null;
    }, 1500);
  } catch {
    errorMessage = 'Unable to copy table code.';
  }
}

async function startGame(): Promise<void> {
  errorMessage = '';
  startPending = true;
  try {
    const requestPlayerId = playerId;
    const payload = await post<GamePayload>(
      `/api/games/${data.gameId}/start`,
      { playerId },
      'Unable to start game.'
    );
    applyGameState(payload.game, requestPlayerId || undefined);
  } catch (error) {
    errorMessage = messageFromError(error, 'Unable to start game.');
  } finally {
    startPending = false;
  }
}

async function resetGame(): Promise<void> {
  if (!playerId) {
    return;
  }

  confirmation = {
    kind: 'reset',
    title: 'Reset this round?',
    message: 'The current round will end and every player will return to the waiting table.',
    confirmLabel: 'Reset round'
  };
}

async function performResetGame(): Promise<void> {
  errorMessage = '';
  resetPending = true;
  try {
    const requestPlayerId = playerId;
    const payload = await post<GamePayload>(
      `/api/games/${data.gameId}/reset`,
      { playerId },
      'Unable to reset game.'
    );
    applyGameState(payload.game, requestPlayerId || undefined);
  } catch (error) {
    errorMessage = messageFromError(error, 'Unable to reset game.');
  } finally {
    resetPending = false;
  }
}

async function leaveTable(): Promise<void> {
  if (!playerId) {
    await goto('/');
    return;
  }

  confirmation = {
    kind: 'leave',
    title: 'Leave this table?',
    message: 'You will return to the lobby and give up your seat at this table.',
    confirmLabel: 'Leave table'
  };
}

async function performLeaveTable(): Promise<void> {
  errorMessage = '';
  leavePending = true;

  try {
    await fetch(`/api/games/${data.gameId}/leave`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ playerId })
    });
  } catch {
    // Best effort only. Local exit should still succeed if the room is already gone.
  }

  clearStoredPlayer(data.gameId);
  realtimeClient?.dispose();
  realtimeClient = null;
  playerId = '';
  leavePending = false;
  await goto('/');
}

async function submitHostAction(path: string, targetId: string, fallbackError: string): Promise<void> {
  if (!playerId) {
    return;
  }

  errorMessage = '';
  actionPending = true;
  try {
    const requestPlayerId = playerId;
    const payload = await post<GamePayload>(
      path,
      { playerId, targetId },
      fallbackError
    );
    applyGameState(payload.game, requestPlayerId || undefined);
  } catch (error) {
    errorMessage = messageFromError(error, fallbackError);
  } finally {
    actionPending = false;
  }
}

async function transferHostTo(targetId: string): Promise<void> {
  const playerName = playerNameById(targetId);
  confirmation = {
    kind: 'transfer',
    title: `Make ${playerName} the host?`,
    message: `${playerName} will take ownership of this table and its host controls.`,
    confirmLabel: 'Transfer ownership',
    targetId
  };
}

async function kickPlayerFromTable(targetId: string): Promise<void> {
  const playerName = playerNameById(targetId);
  confirmation = {
    kind: 'kick',
    title: `Remove ${playerName}?`,
    message: `${playerName} will be removed from this table and disconnected from the game.`,
    confirmLabel: 'Remove player',
    targetId
  };
}

function cancelConfirmation(): void {
  confirmation = null;
}

async function confirmAction(): Promise<void> {
  const confirmedAction = confirmation;
  confirmation = null;

  if (!confirmedAction) {
    return;
  }

  if (confirmedAction.kind === 'leave') {
    await performLeaveTable();
  } else if (confirmedAction.kind === 'reset') {
    await performResetGame();
  } else if (confirmedAction.kind === 'transfer') {
    await submitHostAction(
      `/api/games/${data.gameId}/host`,
      confirmedAction.targetId,
      'Unable to transfer host.'
    );
  } else if (confirmedAction.kind === 'kick') {
    await submitHostAction(
      `/api/games/${data.gameId}/kick`,
      confirmedAction.targetId,
      'Unable to kick player.'
    );
  }
}

async function submitCommand(command: PlayerCommand, fallbackError: string): Promise<void> {
  errorMessage = '';
  actionPending = true;

  try {
    const requestPlayerId = playerId;
    const payload = await post<GamePayload>(
      `/api/games/${data.gameId}/action`,
      {
        playerId,
        command
      },
      fallbackError
    );

    applyGameState(payload.game, requestPlayerId || undefined);
  } catch (error) {
    errorMessage = messageFromError(error, fallbackError);
  } finally {
    actionPending = false;
  }
}

async function takeTurn(): Promise<void> {
  if (actionNeedsTarget && !selectedTargetId) {
    errorMessage = 'Choose a target for this action.';
    return;
  }

  await submitCommand(
    {
      kind: 'action',
      type: selectedAction,
      targetId: actionNeedsTarget ? selectedTargetId : undefined
    },
    'Unable to complete action.'
  );
}

async function passPending(): Promise<void> {
  await submitCommand({ kind: 'pass' }, 'Unable to submit pass.');
}

async function challengePending(): Promise<void> {
  await submitCommand({ kind: 'challenge' }, 'Unable to submit challenge.');
}

async function blockPending(): Promise<void> {
  const role = pending?.type === 'await_action_response' && pending.action === 'steal' ? selectedBlockRole : undefined;
  await submitCommand({ kind: 'block', role }, 'Unable to submit block.');
}

async function revealInfluence(choiceId: string): Promise<void> {
  await submitCommand({ kind: 'reveal', choiceId }, 'Unable to reveal card.');
}

async function confirmExchange(): Promise<void> {
  if (pending?.type !== 'await_exchange') {
    return;
  }
  if (selectedExchangeKeepIds.length !== pending.keepCount) {
    errorMessage = `Choose exactly ${pending.keepCount} card(s).`;
    return;
  }

  await submitCommand({ kind: 'exchange', keepIds: selectedExchangeKeepIds }, 'Unable to submit exchange.');
}

function toggleExchangeOption(optionId: string): void {
  if (pending?.type !== 'await_exchange') {
    return;
  }

  if (selectedExchangeKeepIds.includes(optionId)) {
    selectedExchangeKeepIds = selectedExchangeKeepIds.filter((id) => id !== optionId);
    return;
  }

  if (selectedExchangeKeepIds.length >= pending.keepCount) {
    return;
  }

  selectedExchangeKeepIds = [...selectedExchangeKeepIds, optionId];
}

$effect(() => {
  if (playerId) {
    rememberPlayer(data.gameId, playerId);
  }
});

$effect(() => {
  realtimeClient?.subscribe(playerId);
});

$effect(() => {
  if (!actionNeedsTarget) {
    selectedTargetId = '';
    return;
  }
  const firstTarget = targetablePlayers[0]?.id ?? '';
  if (!targetablePlayers.some((player) => player.id === selectedTargetId)) {
    selectedTargetId = firstTarget;
  }
});

$effect(() => {
  if (!canUseAction(selectedAction)) {
    selectedAction = ACTION_TYPES.find((action) => canUseAction(action)) ?? 'income';
  }
});

$effect(() => {
  if (pending?.type !== 'await_exchange' || pending.playerId !== playerId) {
    selectedExchangeKeepIds = [];
    exchangeSelectionKey = '';
    return;
  }

  const nextExchangeKey = `${pending.keepCount}:${pending.yourOptions.map((option) => option.id).join(',')}`;
  const validIds = new Set(pending.yourOptions.map((option) => option.id));
  const filteredSelection = selectedExchangeKeepIds.filter((id) => validIds.has(id));
  const selectionChanged = filteredSelection.length !== selectedExchangeKeepIds.length;
  selectedExchangeKeepIds = filteredSelection;

  if (exchangeSelectionKey !== nextExchangeKey) {
    selectedExchangeKeepIds = [];
  } else if (selectionChanged && selectedExchangeKeepIds.length === 0) {
    selectedExchangeKeepIds = [];
  }

  exchangeSelectionKey = nextExchangeKey;
});

onMount(() => {
  const queryPlayerId = new URLSearchParams(window.location.search).get('playerId') ?? '';
  playerId = queryPlayerId || readStoredPlayer(data.gameId);

  void refreshGame();
  realtimeClient = createRealtimeClient({
    gameId: data.gameId,
    getPlayerId: () => playerId,
    onGameState: (nextGame, viewerPlayerId) => {
      applyGameState(nextGame, viewerPlayerId);
    },
    onError: (message) => {
      errorMessage = message;
    },
    onStatusChange: () => {}
  });
  realtimeClient.connect();

  return () => {
    if (copyFeedbackTimer) {
      clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = null;
    }
    realtimeClient?.dispose();
    realtimeClient = null;
  };
});
</script>

<svelte:head>
  <title>Coup Table {data.gameId}</title>
</svelte:head>

<main class="game">
  <section class="panel panel-base header">
    <div class="table-heading">
      <h1>
        Table <span>{data.gameId}</span>
      </h1>
      <button
        type="button"
        class="copy-code-btn btn"
        aria-label={tableCodeCopied ? 'Table code copied' : 'Copy table code'}
        title={tableCodeCopied ? 'Copied' : 'Copy table code'}
        onclick={copyGameId}
      >
        <Copy size={16} aria-hidden="true" />
      </button>
    </div>

    <div class="top-controls">
      {#if !playerId}
        <div class="compact-row">
          <input class="input-base" bind:value={joinName} maxlength="24" placeholder="Player name" disabled={joinPending} />
          <button type="button" class="btn" onclick={joinGame} disabled={joinPending || !joinName.trim()}>
            {joinPending ? 'Joining...' : 'Join'}
          </button>
        </div>
      {/if}

      {#if game?.status === 'waiting'}
        {#if playerId && isHost}
          <button
            type="button"
            class="btn"
            onclick={startGame}
            disabled={startPending || (game?.players.length ?? 0) < 2}
          >
            {startPending ? 'Starting...' : 'Start'}
          </button>
        {:else if playerId}
          <p class="muted">Waiting for host.</p>
        {/if}
      {:else if game?.status === 'active'}
        {#if !pending}
          {#if isYourTurn}
            <div class="compact-row">
              <select class="input-base" bind:value={selectedAction}>
                {#each ACTION_TYPES as action}
                  <option value={action} disabled={!canUseAction(action)}>{ACTION_LABEL[action]}</option>
                {/each}
              </select>

              {#if actionNeedsTarget}
                <select class="input-base" bind:value={selectedTargetId} disabled={targetablePlayers.length === 0}>
                  {#each targetablePlayers as player}
                    <option value={player.id}>{player.name}</option>
                  {/each}
                </select>
              {/if}

              <button type="button" class="btn" onclick={takeTurn} disabled={actionPending}>
                {actionPending ? '...' : 'Play'}
              </button>
            </div>
          {:else if playerId}
            <p class="muted">{currentTurnName} is acting.</p>
          {/if}
        {:else if pending.type === 'await_action_response'}
          <div class="pending-box">
            <p>
              {playerNameById(pending.actorId)} claims <strong>{pending.claimRole}</strong> for
              <strong>{ACTION_LABEL[pending.action]}</strong>.
              {#if pending.pendingPlayerIds.length === 1}
                {playerNameById(pending.pendingPlayerIds[0])} may challenge, block, or pass.
              {:else}
                Eligible players may challenge, block, or pass.
              {/if}
            </p>
            {#if pending.pendingPlayerIds.includes(playerId)}
              <div class="compact-row">
                {#if pending.action === 'steal'}
                  <select class="input-base" bind:value={selectedBlockRole}>
                    <option value="captain">Captain</option>
                    <option value="ambassador">Ambassador</option>
                  </select>
                {/if}
                <button type="button" class="btn" onclick={challengePending} disabled={actionPending}>Challenge</button>
                <button type="button" class="btn" onclick={blockPending} disabled={actionPending}>Block</button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick={passPending}
                  disabled={actionPending}
                >
                  Pass
                </button>
              </div>
            {/if}
          </div>
        {:else if pending.type === 'await_action_challenge'}
          <div class="pending-box">
            <p>
              {playerNameById(pending.actorId)} claims <strong>{pending.claimRole}</strong> for
              <strong>{ACTION_LABEL[pending.action]}</strong>.
              {#if pending.targetId && (pending.action === 'steal' || pending.action === 'assassinate')}
                Only {playerNameById(pending.targetId)} may challenge.
              {:else}
                Eligible players may challenge.
              {/if}
            </p>
            {#if pending.pendingPlayerIds.includes(playerId)}
              <div class="compact-row">
                <button type="button" class="btn" onclick={challengePending} disabled={actionPending}>Challenge</button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick={passPending}
                  disabled={actionPending}
                >
                  Pass
                </button>
              </div>
            {/if}
          </div>
        {:else if pending.type === 'await_block'}
          <div class="pending-box">
            <p>
              {playerNameById(pending.actorId)} attempts <strong>{ACTION_LABEL[pending.action]}</strong>.
              Eligible blockers may respond.
            </p>
            {#if pending.pendingPlayerIds.includes(playerId)}
              <div class="compact-row">
                {#if pending.action === 'steal'}
                  <select class="input-base" bind:value={selectedBlockRole}>
                    <option value="captain">Captain</option>
                    <option value="ambassador">Ambassador</option>
                  </select>
                {/if}
                <button type="button" class="btn" onclick={blockPending} disabled={actionPending}>Block</button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick={passPending}
                  disabled={actionPending}
                >
                  Pass
                </button>
              </div>
            {/if}
          </div>
        {:else if pending.type === 'await_block_challenge'}
          <div class="pending-box">
            <p>
              {playerNameById(pending.blockerId)} blocks with <strong>{pending.blockRole}</strong>.
              Only {playerNameById(pending.actorId)} may challenge.
            </p>
            {#if pending.pendingPlayerIds.includes(playerId)}
              <div class="compact-row">
                <button type="button" class="btn" onclick={challengePending} disabled={actionPending}>Challenge</button>
                <button
                  type="button"
                  class="btn btn-secondary"
                  onclick={passPending}
                  disabled={actionPending}
                >
                  Pass
                </button>
              </div>
            {/if}
          </div>
        {:else if pending.type === 'await_influence'}
          <div class="pending-box">
            <p>{playerNameById(pending.playerId)} must reveal an influence card.</p>
            {#if pending.playerId === playerId}
              <div class="compact-row">
                {#each pending.yourChoices as choice}
                  <button
                    type="button"
                    class="btn"
                    onclick={() => revealInfluence(choice.id)}
                    disabled={actionPending}
                  >
                    Reveal {choice.card}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {:else if pending.type === 'await_exchange'}
          <div class="pending-box">
            <p>{playerNameById(pending.playerId)} is exchanging cards.</p>
            {#if pending.playerId === playerId}
              <p class="muted">Choose exactly {pending.keepCount} card(s) to keep by clicking your cards below.</p>
              <button
                type="button"
                class="btn"
                onclick={confirmExchange}
                disabled={actionPending || selectedExchangeKeepIds.length !== pending.keepCount}
              >
                Confirm Exchange
              </button>
            {/if}
          </div>
        {/if}
      {:else if game?.status === 'finished'}
        <p class="muted">Round complete.</p>
      {/if}

      {#if playerId && isHost && game}
        <button
          type="button"
          class="btn btn-secondary compact"
          onclick={resetGame}
          disabled={resetPending || startPending || actionPending}
        >
          {resetPending ? 'Resetting...' : 'Reset'}
        </button>
      {/if}

      {#if playerId}
        <button
          type="button"
          class="btn btn-secondary compact leave-btn"
          onclick={leaveTable}
          disabled={leavePending || joinPending || startPending || resetPending || actionPending}
        >
          <LogOut size={14} aria-hidden="true" />
          {leavePending ? 'Leaving...' : 'Exit'}
        </button>
      {/if}
    </div>
  </section>

  <section class="panel panel-base">
    <h2>Players</h2>
    <GamePlayersList
      {game}
      {playerId}
      {you}
      exchangePending={pending?.type === 'await_exchange' && pending.playerId === playerId ? pending : null}
      {selectedExchangeKeepIds}
      canManage={isHost}
      controlsDisabled={actionPending || startPending || resetPending}
      onToggleExchangeOption={toggleExchangeOption}
      onPreviewCard={previewCard}
      onTransferHost={transferHostTo}
      onKick={kickPlayerFromTable}
    />
  </section>

  {#if errorMessage}
    <p class="error-text error-text-animated">{errorMessage}</p>
  {/if}

  <ConfirmDialog
    open={confirmation !== null}
    title={confirmation?.title ?? ''}
    message={confirmation?.message ?? ''}
    confirmLabel={confirmation?.confirmLabel ?? 'Confirm'}
    onConfirm={confirmAction}
    onCancel={cancelConfirmation}
  />
  <CardSpotlight card={spotlightCard} onClose={closeCardSpotlight} />
</main>

<style>
.game {
  --asset-build-marker: 1;
  max-width: 34rem;
  margin: 0 auto;
  padding: 0.75rem;
  display: grid;
  gap: 1rem;
}

.panel {
  display: grid;
  gap: 0.45rem;
}

h1,
h2 {
  margin: 0;
}

.table-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.header h1 {
  font-size: 1.1rem;
  letter-spacing: 0.01em;
  color: #fff2ca;
  text-shadow: 0 2px 14px rgb(0 0 0 / 32%);
  animation: title-throb 2.5s ease-in-out infinite;
}

.header h1 span {
  letter-spacing: 0.08em;
}

.copy-code-btn.btn {
  --btn-padding: 0.35rem;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  min-height: 2rem;
}

.top-controls {
  margin-top: 0.45rem;
  display: grid;
  gap: 0.38rem;
}

.pending-box {
  display: grid;
  gap: 0.45rem;
  padding: 0.5rem;
  border-radius: 0.5rem;
  border: 1px solid rgb(248 204 111 / 22%);
  background: rgb(0 0 0 / 16%);
}

.pending-box p {
  margin: 0;
  color: #f0e2bf;
}

.compact-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.muted {
  margin: 0;
  font-size: 0.84rem;
  color: #e6d7b0;
}

.compact-row input,
.compact-row select {
  flex: 1 1 7.5rem;
}

.input-base,
.btn {
  --control-radius: 0.55rem;
  --btn-line-height: 1.1;
}

.input-base {
  --input-base-padding: 0.42rem 0.54rem;
}

.btn {
  --btn-padding: 0.42rem 0.54rem;
}

.compact {
  justify-self: start;
}

.leave-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

@keyframes title-throb {
  0%,
  100% {
    transform: translateY(0);
    text-shadow: 0 2px 14px rgb(0 0 0 / 32%);
  }
  50% {
    transform: translateY(-1px);
    text-shadow: 0 2px 17px rgb(249 214 127 / 32%);
  }
}
</style>
