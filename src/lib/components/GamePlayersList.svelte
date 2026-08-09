<script lang="ts">
import { flip } from 'svelte/animate';
import { cubicInOut } from 'svelte/easing';
import { onDestroy } from 'svelte';
import { Crown, Skull, UserX, Wifi, WifiOff } from 'lucide-svelte';
import type { InfluenceCard, PlayerView, PublicGameState } from '$lib/game/types';
import CoupCard from '$lib/components/CoupCard.svelte';

type CardSlot = { card: PlayerView['cards'][number] | null; hidden: boolean; revealed: boolean };
type CoinToken = { id: string };
type ExchangePending = Extract<NonNullable<PublicGameState['pending']>, { type: 'await_exchange' }>;
type DisplayCard = {
  key: string;
  card: PlayerView['cards'][number] | null;
  hidden: boolean;
  revealed: boolean;
  positionIndex?: number;
  shiftSlots?: number;
  optionId?: string;
  selectable: boolean;
  selected: boolean;
  extra: boolean;
  collapsingOut?: boolean;
};

const MAX_RENDERED_COINS = 12;
const TOTAL_INFLUENCE_SLOTS = 2;
const COIN_STAGGER_MS = 120;

let {
  game,
  playerId,
  you,
  exchangePending = null,
  selectedExchangeKeepIds = [],
  canManage = false,
  controlsDisabled = false,
  onToggleExchangeOption = () => {},
  onPreviewCard = () => {},
  onTransferHost = async () => {},
  onKick = async () => {}
} = $props<{
  game: PublicGameState | null;
  playerId: string;
  you: PlayerView | null;
  exchangePending?: ExchangePending | null;
  selectedExchangeKeepIds?: string[];
  canManage?: boolean;
  controlsDisabled?: boolean;
  onToggleExchangeOption?: (optionId: string) => void;
  onPreviewCard?: (card: InfluenceCard) => void;
  onTransferHost?: (targetId: string) => void | Promise<void>;
  onKick?: (targetId: string) => void | Promise<void>;
}>();

let renderedCoinsByPlayer = $state<Record<string, CoinToken[]>>({});
let scheduledCoinTargets = $state<Record<string, number>>({});
let nextCoinTokenId = 0;

const coinTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

function nextCoinToken(): CoinToken {
  nextCoinTokenId += 1;
  return { id: `coin-${nextCoinTokenId}` };
}

function renderedCoinCount(totalCoins: number): number {
  const safeCoins = Math.max(0, totalCoins);
  return Math.min(safeCoins, MAX_RENDERED_COINS);
}

function clearCoinTimers(playerId: string): void {
  const timers = coinTimers.get(playerId);
  if (!timers) {
    return;
  }

  for (const timer of timers) {
    clearTimeout(timer);
  }

  coinTimers.delete(playerId);
}

function setCoinsImmediately(playerId: string, count: number): void {
  renderedCoinsByPlayer[playerId] = Array.from({ length: count }, () => nextCoinToken());
  scheduledCoinTargets[playerId] = count;
}

function scheduleCoinCount(playerId: string, desiredCount: number): void {
  if (scheduledCoinTargets[playerId] === desiredCount) {
    return;
  }

  clearCoinTimers(playerId);

  const currentCount = renderedCoinsByPlayer[playerId]?.length ?? 0;
  scheduledCoinTargets[playerId] = desiredCount;

  if (currentCount === desiredCount) {
    return;
  }

  const timers: ReturnType<typeof setTimeout>[] = [];
  const steps = Math.abs(desiredCount - currentCount);

  for (let step = 0; step < steps; step += 1) {
    const timer = setTimeout(() => {
      const currentCoins = renderedCoinsByPlayer[playerId] ?? [];

      if (desiredCount > currentCount) {
        renderedCoinsByPlayer[playerId] = [...currentCoins, nextCoinToken()];
      } else {
        renderedCoinsByPlayer[playerId] = currentCoins.slice(0, -1);
      }

      if (step === steps - 1) {
        coinTimers.delete(playerId);
      }
    }, step * COIN_STAGGER_MS);

    timers.push(timer);
  }

  coinTimers.set(playerId, timers);
}

function coinTravelDistance(node: Element): number {
  const parent = node.parentElement;
  if (!parent) {
    return 24;
  }

  const parentRect = parent.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  return Math.max(24, parentRect.right - nodeRect.right + 8);
}

function coinSlide(node: Element, options: { duration: number; exiting?: boolean }) {
  const distance = coinTravelDistance(node);
  const { duration, exiting = false } = options;

  return {
    duration,
    easing: cubicInOut,
    css: (t: number) => {
      const progress = exiting ? 1 - t : t;
      const x = exiting ? progress * distance : (1 - progress) * distance;
      const y = exiting ? progress * 6 : (1 - progress) * 6;
      const opacity = exiting ? 1 - progress * 0.75 : 0.25 + progress * 0.75;

      return `transform: translate(${x}px, ${y}px); opacity: ${opacity};`;
    }
  };
}

function exchangeTravelDistance(node: Element): number {
  const parent = node.parentElement;
  if (!parent) {
    return 64;
  }

  const parentRect = parent.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  return Math.max(64, parentRect.right - nodeRect.left + 28);
}

function exchangeCardSlide(node: Element, options: { duration: number; exiting?: boolean }) {
  const distance = exchangeTravelDistance(node);
  const { duration, exiting = false } = options;

  return {
    duration,
    easing: cubicInOut,
    css: (t: number) => {
      const progress = exiting ? 1 - t : t;
      const x = exiting ? progress * distance : (1 - progress) * distance;
      const opacity = exiting ? 1 - progress * 0.75 : 0.24 + progress * 0.76;
      const scale = exiting ? 1 - progress * 0.08 : 0.92 + progress * 0.08;

      return `transform: translateX(${x}px) scale(${scale}); opacity: ${opacity};`;
    }
  };
}

function standardPlayerCardSlots(player: PublicGameState['players'][number]): CardSlot[] {
  if (player.id === playerId && you) {
    const mySlots: CardSlot[] = [
      ...you.cards.map((card: PlayerView['cards'][number]) => ({ card, hidden: false, revealed: false })),
      ...you.revealedCards.map((card: PlayerView['cards'][number]) => ({ card, hidden: false, revealed: true }))
    ];

    while (mySlots.length < TOTAL_INFLUENCE_SLOTS) {
      mySlots.push({ card: null, hidden: true, revealed: false });
    }
    return mySlots.slice(0, TOTAL_INFLUENCE_SLOTS);
  }

  const revealedCards = player.revealedCards.slice(0, TOTAL_INFLUENCE_SLOTS);
  const hiddenCount = TOTAL_INFLUENCE_SLOTS - revealedCards.length;
  const slots: CardSlot[] = [];

  for (let index = 0; index < hiddenCount; index += 1) {
    slots.push({ card: null, hidden: true, revealed: false });
  }

  for (let index = 0; index < revealedCards.length; index += 1) {
    slots.push({ card: revealedCards[index] ?? null, hidden: false, revealed: true });
  }

  return slots;
}

function playerDisplayCards(player: PublicGameState['players'][number]): DisplayCard[] {
  const baseCards = standardPlayerCardSlots(player).map((slot, index) => ({
    key: `${player.id}-slot-${index}`,
    card: slot.card,
    hidden: slot.hidden,
    revealed: slot.revealed,
    positionIndex: index,
    selectable: false,
    selected: false,
    extra: false
  }));

  if (player.id !== playerId || !you || !exchangePending || exchangePending.playerId !== playerId) {
    return baseCards;
  }

  const selectedIds = new Set(selectedExchangeKeepIds);
  const selectionComplete = selectedExchangeKeepIds.length === exchangePending.keepCount;
  const selectedOptionIds = exchangePending.yourOptions
  .filter((option: ExchangePending['yourOptions'][number]) => selectedIds.has(option.id))
  .map((option: ExchangePending['yourOptions'][number]) => option.id);
  const revealedCards = you.revealedCards.map((card: PlayerView['cards'][number], index: number) => ({
    // Keep influence-slot keys stable when entering and leaving the exchange
    // layout. Otherwise Svelte retains the old revealed card for the grouped
    // outros while also rendering its replacement, producing a third card.
    key: `${player.id}-slot-${you.cards.length + index}`,
    card,
    hidden: false,
    revealed: true,
    positionIndex: exchangePending.yourOptions.length + index,
    shiftSlots: selectionComplete ? index + selectedOptionIds.length - (exchangePending.yourOptions.length + index) : 0,
    selectable: false,
    selected: false,
    extra: false
  }));
  const concealedCards = you.cards.map((card: PlayerView['cards'][number], index: number) => {
    const option = exchangePending.yourOptions[index];
    const selected = option ? selectedIds.has(option.id) : false;

    return {
      key: `${player.id}-slot-${index}`,
      card,
      hidden: false,
      revealed: false,
      positionIndex: index,
      shiftSlots: selectionComplete && selected ? selectedOptionIds.indexOf(option?.id ?? '') - index : 0,
      optionId: option?.id,
      selectable: Boolean(option),
      selected,
      extra: false,
      collapsingOut: selectionComplete && Boolean(option) && !selected
    };
  });
  const extraCards = exchangePending.yourOptions.slice(you.cards.length).map((option: ExchangePending['yourOptions'][number]) => ({
    key: `exchange-extra-${option.id}`,
    card: option.card,
    hidden: false,
    revealed: false,
    positionIndex: exchangePending.yourOptions.findIndex((entry: ExchangePending['yourOptions'][number]) => entry.id === option.id),
    shiftSlots: selectionComplete && selectedIds.has(option.id) ? selectedOptionIds.indexOf(option.id) - exchangePending.yourOptions.findIndex((entry: ExchangePending['yourOptions'][number]) => entry.id === option.id) : 0,
    optionId: option.id,
    selectable: true,
    selected: selectedIds.has(option.id),
    extra: true,
    collapsingOut: selectionComplete && !selectedIds.has(option.id)
  }));

  return [...concealedCards, ...extraCards, ...revealedCards];
}

function handleCardInteraction(slot: DisplayCard): void {
  if (slot.selectable && slot.optionId) {
    if (!controlsDisabled) {
      onToggleExchangeOption(slot.optionId);
    }
    return;
  }

  if (slot.card) {
    onPreviewCard(slot.card);
  }
}

function exchangeEnterOptions(slot: DisplayCard): { duration: number } {
  return { duration: slot.extra ? 320 : 0 };
}

function exchangeExitOptions(slot: DisplayCard): { duration: number; exiting: true } {
  return { duration: slot.selectable ? 280 : 0, exiting: true };
}

$effect(() => {
  const activePlayerIds = new Set((game?.players ?? []).map((player: PublicGameState['players'][number]) => player.id));

  for (const playerId of Object.keys(renderedCoinsByPlayer)) {
    if (activePlayerIds.has(playerId)) {
      continue;
    }

    clearCoinTimers(playerId);
    delete renderedCoinsByPlayer[playerId];
    delete scheduledCoinTargets[playerId];
  }

  for (const player of game?.players ?? []) {
    const desiredCount = renderedCoinCount(player.coins);

    if (!(player.id in renderedCoinsByPlayer)) {
      setCoinsImmediately(player.id, desiredCount);
      continue;
    }

    scheduleCoinCount(player.id, desiredCount);
  }
});

onDestroy(() => {
  for (const timers of coinTimers.values()) {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  }

  coinTimers.clear();
});
</script>

<ul class="players">
  {#if game}
    {#each game.players as player (player.id)}
      <li class:active={game.currentTurnPlayerId === player.id} class:me={player.id === playerId} class:dead={!player.isAlive}>
        <div class="player-shell">
          <div class="player-top">
            <strong>{player.name}</strong>
            {#if player.id === playerId}<span class="tag">You</span>{/if}
            {#if player.id === game.hostPlayerId}
              <span class="presence" title="Host" aria-label="Host">
                <Crown size={12} aria-hidden="true" />
              </span>
            {/if}

            <div class="presence" class:offline={!player.connected} title={player.connected ? 'Connected' : 'Disconnected'}>
              {#if player.connected}
                <Wifi size={14} aria-hidden="true" />
              {:else}
                <WifiOff size={14} aria-hidden="true" />
              {/if}
            </div>
            {#if canManage && player.id !== game.hostPlayerId}
              <button
                type="button"
                class="icon-btn btn"
                title="Transfer host"
                disabled={controlsDisabled || (game.status === 'active' && !player.isAlive)}
                onclick={() => onTransferHost(player.id)}
              >
                <Crown size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                class="icon-btn btn btn-danger"
                title="Kick player"
                disabled={controlsDisabled}
                onclick={() => onKick(player.id)}
              >
                <UserX size={14} aria-hidden="true" />
              </button>
            {/if}
          </div>

          <div
            class="player-cards"
            class:exchange-layout={player.id === playerId && Boolean(exchangePending)}
            aria-label={`${player.name} influence`}
          >
            {#each playerDisplayCards(player) as slot (slot.key)}
              <div
                class="player-card-entry"
                class:selected={slot.selected}
                class:shifted={Boolean(slot.shiftSlots)}
                class:collapsing-out={Boolean(slot.collapsingOut)}
                style={slot.positionIndex !== undefined ? `--exchange-slot:${slot.positionIndex + 1}; --shift-slots:${slot.shiftSlots ?? 0};` : undefined}
                in:exchangeCardSlide={exchangeEnterOptions(slot)}
                out:exchangeCardSlide={exchangeExitOptions(slot)}
              >
                <CoupCard
                  card={slot.card}
                  hidden={slot.hidden}
                  revealed={slot.revealed}
                  size="sm"
                  animate={false}
                  showLabel={false}
                  pressable={slot.selectable || Boolean(slot.card)}
                  selected={slot.selected}
                  onPress={() => handleCardInteraction(slot)}
                />
              </div>
            {/each}
          </div>

          <div class="player-meta">
            <div class="coin-strip" aria-label={`${player.coins} coins`}>
              {#each renderedCoinsByPlayer[player.id] ?? [] as coin (coin.id)}
                <img
                  src="/coin.png"
                  alt=""
                  aria-hidden="true"
                  class="coin-token"
                  animate:flip={{ duration: 260 }}
                  in:coinSlide={{ duration: 360 }}
                  out:coinSlide={{ duration: 300, exiting: true }}
                />
              {/each}
            </div>
          </div>
        </div>
        {#if !player.isAlive}
          <div class="death-mark" aria-hidden="true">
            <Skull size={52} strokeWidth={2.2} />
          </div>
        {/if}
      </li>
    {/each}
  {:else}
    <li>Loading players...</li>
  {/if}
</ul>

<style>
.players {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.6rem;
  margin-bottom: 0;
  padding-left: 0;
  list-style: none;
}

.players li {
  position: relative;
  padding: 0.6rem;
  border: 1px solid rgb(248 207 113 / 22%);
  border-radius: 0.65rem;
  background: linear-gradient(130deg, rgb(6 24 20 / 90%) 0%, rgb(3 14 12 / 88%) 100%);
  box-shadow: 0 0 0 1px rgb(248 205 112 / 8%) inset;
}

.players li.active {
  border-color: rgb(139 233 186 / 62%);
  box-shadow:
    0 0 0 1px rgb(139 233 186 / 30%) inset,
    0 0 0.8rem rgb(139 233 186 / 15%);
}

.players li.me {
  background: linear-gradient(130deg, rgb(7 31 25 / 93%) 0%, rgb(3 17 14 / 92%) 100%);
}

.players li.dead {
  border-color: rgb(188 112 103 / 38%);
  background: linear-gradient(130deg, rgb(28 17 16 / 92%) 0%, rgb(17 11 11 / 94%) 100%);
  box-shadow:
    0 0 0 1px rgb(190 118 108 / 10%) inset,
    0 0.4rem 1.1rem rgb(0 0 0 / 24%);
}

.player-shell {
  position: relative;
  z-index: 1;
}

.players li.dead .player-shell {
  opacity: 0.38;
  filter: grayscale(0.9) saturate(0.5);
}

.death-mark {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(255 236 210 / 82%);
  text-shadow: 0 0 1.2rem rgb(167 69 58 / 35%);
  pointer-events: none;
}

.player-top {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.presence {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  color: #f0d8a5;
  background: rgb(0 0 0 / 22%);
  border: 1px solid rgb(248 204 111 / 18%);
}

.presence.offline {
  color: #f4b9ae;
  background: linear-gradient(135deg, rgb(80 23 18 / 94%) 0%, rgb(60 13 10 / 96%) 100%);
  border-color: rgb(186 70 58 / 42%);
}

.icon-btn {
  --control-radius: 0.45rem;
  --btn-padding: 0;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.65rem;
  height: 1.65rem;
  box-shadow: none;
}

.icon-btn.btn-danger {
  margin-left: 0.2rem;
}

.icon-btn:disabled {
  opacity: 0.55;
}

.player-cards {
  position: relative;
  margin-top: 0.4rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: flex-start;
}

.player-cards.exchange-layout {
  display: grid;
  grid-template-columns: repeat(4, max-content);
  justify-content: start;
  --exchange-step: calc(82px + 0.45rem);
}

.player-cards.exchange-layout .player-card-entry {
  grid-column: var(--exchange-slot);
  transition:
    transform 240ms cubic-bezier(0.22, 0.8, 0.26, 1),
    opacity 220ms ease,
    filter 220ms ease;
}

.player-card-entry {
  display: block;
  border-radius: 0.75rem;
}

.player-cards.exchange-layout .player-card-entry.shifted {
  transform: translateX(calc(var(--shift-slots) * var(--exchange-step)));
}

.player-cards.exchange-layout .player-card-entry.collapsing-out {
  transform: translateX(calc(1.1 * var(--exchange-step))) scale(0.92);
  opacity: 0;
  filter: saturate(0.82);
  pointer-events: none;
}

.player-card-entry.selected {
  position: relative;
  z-index: 2;
  box-shadow:
    0 0 0 1px rgb(139 233 186 / 46%) inset,
    0 0 0.9rem rgb(139 233 186 / 18%);
  filter: saturate(1.08);
}

.player-meta {
  margin-top: 0.32rem;
  display: grid;
  gap: 0.35rem;
}

.tag {
  margin-left: 0.4rem;
  padding: 0.1rem 0.35rem;
  font-size: 0.68rem;
  text-transform: uppercase;
  border-radius: 999px;
  background: rgb(249 210 126 / 18%);
}


.coin-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.18rem;
  min-height: 1.75rem;
  padding: 0.2rem 0.35rem;
  border-radius: 0.55rem;
  background: rgb(0 0 0 / 18%);
  border: 1px solid rgb(248 206 114 / 10%);
}

.coin-token {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  object-fit: fill;
  filter: drop-shadow(0 1px 0 rgb(0 0 0 / 55%));
  will-change: transform, opacity;
}
</style>
