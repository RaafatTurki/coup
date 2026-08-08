<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import type { InfluenceCard } from '$lib/game/types';

type CardSize = 'sm' | 'md' | 'lg';

const SIZE_SCALE: Record<CardSize, number> = { sm: 2, md: 3, lg: 4 };
const CARD_INDEX: Record<InfluenceCard, number> = {
  duke: 0,
  contessa: 1,
  captain: 2,
  assassin: 3,
  ambassador: 4
};

function isInfluenceCard(value: unknown): value is InfluenceCard {
  return value === 'duke' || value === 'contessa' || value === 'captain' || value === 'assassin' || value === 'ambassador';
}

function isCardSize(value: unknown): value is CardSize {
  return value === 'sm' || value === 'md' || value === 'lg';
}

let {
  card = null,
  hidden = false,
  revealed = false,
  size = 'md',
  animate = true,
  delayMs = 0,
  showLabel = true,
  pressable = false,
  selected = false,
  onPress = () => {}
} = $props<{
  card?: InfluenceCard | null;
  hidden?: boolean;
  revealed?: boolean;
  size?: CardSize;
  animate?: boolean;
  delayMs?: number;
  showLabel?: boolean;
  pressable?: boolean;
  selected?: boolean;
  onPress?: () => void;
}>();

const REVEAL_ANIMATION_MS = 460;
const SWAP_OUT_ANIMATION_MS = 170;
const SWAP_IN_ANIMATION_MS = 220;

let animationState = $state<'idle' | 'reveal' | 'swap-out' | 'swap-in'>('idle');
let revealAnimationTimer: ReturnType<typeof setTimeout> | null = null;
let swapOutTimer: ReturnType<typeof setTimeout> | null = null;
let swapInTimer: ReturnType<typeof setTimeout> | null = null;
let animationReady = false;
let previousCard: InfluenceCard | null = null;
let previousHidden = false;
let previousRevealed = false;
let ignoreNextClick = $state(false);
let renderedCard = $state<InfluenceCard | null>(null);
let renderedHidden = $state(false);
let renderedRevealed = $state(false);

const sourceCard = $derived(card);
const sourceHidden = $derived(hidden);
const sourceRevealed = $derived(revealed);
const faceDown = $derived(renderedHidden || !isInfluenceCard(renderedCard));
const safeSize = $derived(isCardSize(size) ? size : 'md');
const scale = $derived(SIZE_SCALE[safeSize]);
const cardIndex = $derived(isInfluenceCard(renderedCard) ? CARD_INDEX[renderedCard] : 0);
const cardLabel = $derived(
  isInfluenceCard(renderedCard)
    ? renderedCard.slice(0, 1).toUpperCase() + renderedCard.slice(1)
    : renderedHidden
      ? 'Hidden'
      : 'Unknown'
);

function clearAnimationTimers(): void {
  if (revealAnimationTimer) {
    clearTimeout(revealAnimationTimer);
    revealAnimationTimer = null;
  }

  if (swapOutTimer) {
    clearTimeout(swapOutTimer);
    swapOutTimer = null;
  }

  if (swapInTimer) {
    clearTimeout(swapInTimer);
    swapInTimer = null;
  }

  animationState = 'idle';
}

function applyRenderedState(nextCard: InfluenceCard | null, nextHidden: boolean, nextRevealed: boolean): void {
  renderedCard = nextCard;
  renderedHidden = nextHidden;
  renderedRevealed = nextRevealed;
}

function triggerRevealAnimation(): void {
  clearAnimationTimers();

  requestAnimationFrame(() => {
    animationState = 'reveal';
    revealAnimationTimer = setTimeout(() => {
      animationState = 'idle';
      revealAnimationTimer = null;
    }, REVEAL_ANIMATION_MS);
  });
}

function triggerSwapAnimation(nextCard: InfluenceCard | null, nextHidden: boolean, nextRevealed: boolean): void {
  clearAnimationTimers();

  requestAnimationFrame(() => {
    animationState = 'swap-out';
    swapOutTimer = setTimeout(() => {
      applyRenderedState(nextCard, nextHidden, nextRevealed);
      animationState = 'idle';
      swapOutTimer = null;

      requestAnimationFrame(() => {
        animationState = 'swap-in';
        swapInTimer = setTimeout(() => {
          animationState = 'idle';
          swapInTimer = null;
        }, SWAP_IN_ANIMATION_MS);
      });
    }, SWAP_OUT_ANIMATION_MS);
  });
}

function syncPreviousState(nextCard: InfluenceCard | null, nextHidden: boolean, nextRevealed: boolean): void {
  previousCard = nextCard;
  previousHidden = nextHidden;
  previousRevealed = nextRevealed;
}

function handleCardPressStart(event: PointerEvent): void {
  if (!pressable || event.button !== 0) {
    return;
  }

  ignoreNextClick = true;
  event.preventDefault();
  onPress();
}

function handleCardClick(): void {
  if (!pressable) {
    return;
  }

  if (ignoreNextClick) {
    ignoreNextClick = false;
    return;
  }

  onPress();
}

onMount(() => {
  animationReady = true;
  applyRenderedState(sourceCard, sourceHidden, sourceRevealed);
  syncPreviousState(sourceCard, sourceHidden, sourceRevealed);
});

onDestroy(() => {
  clearAnimationTimers();
});

$effect(() => {
  if (!animationReady) {
    return;
  }

  const becameRevealed = !previousRevealed && sourceRevealed;
  const turnedFaceUp = previousHidden && !sourceHidden;
  const cardChanged = previousCard !== sourceCard;

  if (becameRevealed || turnedFaceUp) {
    applyRenderedState(sourceCard, sourceHidden, sourceRevealed);
    triggerRevealAnimation();
  } else if (cardChanged) {
    triggerSwapAnimation(sourceCard, sourceHidden, sourceRevealed);
  } else if (renderedCard !== sourceCard || renderedHidden !== sourceHidden || renderedRevealed !== sourceRevealed) {
    clearAnimationTimers();
    applyRenderedState(sourceCard, sourceHidden, sourceRevealed);
  }

  syncPreviousState(sourceCard, sourceHidden, sourceRevealed);
});
</script>

<figure
  class="coup-card"
  class:animate
  class:revealed={renderedRevealed}
  style={`--scale: ${scale}; --card-index: ${cardIndex}; animation-delay: ${delayMs}ms;`}
>
  {#if pressable}
    <button
      type="button"
      class="card-button"
      class:selected
      aria-pressed={selected}
      onclick={handleCardClick}
      onpointerdown={handleCardPressStart}
    >
      <div
        class="card-shell"
        class:animating-reveal={animationState === 'reveal'}
        class:animating-swap-out={animationState === 'swap-out'}
        class:animating-swap-in={animationState === 'swap-in'}
        title={cardLabel}
      >
        {#if faceDown}
          <div class="back-face" aria-label="Hidden card"><span>COUP</span></div>
        {:else}
          <div class="face-art" role="img" aria-label={cardLabel}></div>
        {/if}
      </div>
    </button>
  {:else}
    <div
      class="card-shell"
      class:animating-reveal={animationState === 'reveal'}
      class:animating-swap-out={animationState === 'swap-out'}
      class:animating-swap-in={animationState === 'swap-in'}
      title={cardLabel}
    >
      {#if faceDown}
        <div class="back-face" aria-label="Hidden card"><span>COUP</span></div>
      {:else}
        <div class="face-art" role="img" aria-label={cardLabel}></div>
      {/if}
    </div>
  {/if}
  {#if showLabel}
    <figcaption>{cardLabel}</figcaption>
  {/if}
</figure>

<style>
.coup-card {
  margin: 0;
  display: grid;
  justify-items: center;
  gap: 0.3rem;
}

.coup-card.animate {
  animation: float 1.9s ease-in-out infinite;
}

.coup-card.revealed {
  opacity: 0.4;
  filter: grayscale(0.7) saturate(0.7);
}

.card-button {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
}

.card-button.selected {
  filter: drop-shadow(0 0 0.65rem rgb(139 233 186 / 30%));
}

.card-button:focus-visible {
  outline: 2px solid rgb(248 210 126 / 72%);
  outline-offset: 3px;
  border-radius: 0.8rem;
}

.card-shell {
  width: calc(41px * var(--scale));
  height: calc(49px * var(--scale));
  position: relative;
  border-radius: 0.62rem;
  overflow: hidden;
  border: 1px solid rgb(245 201 101 / 54%);
  background: linear-gradient(154deg, rgb(10 41 31 / 96%) 0%, rgb(3 20 17 / 98%) 100%);
  box-shadow:
    0 0.55rem 1rem rgb(0 0 0 / 38%),
    0 0 0 1px rgb(248 220 158 / 12%) inset;
  transform-origin: 50% 50%;
  will-change: transform, filter, opacity;
}

.card-shell.animating-reveal {
  animation: reveal-snap 460ms cubic-bezier(0.2, 0.85, 0.24, 1) both;
}

.card-shell.animating-swap-out {
  animation: swap-out 170ms cubic-bezier(0.48, 0, 0.84, 0.34) both;
}

.card-shell.animating-swap-in {
  animation: swap-in 220ms cubic-bezier(0.18, 0.84, 0.3, 1) both;
}

.card-shell::after {
  content: '';
  position: absolute;
  inset: -20% -40%;
  pointer-events: none;
  background: linear-gradient(110deg, rgb(255 255 255 / 0%) 40%, rgb(255 238 188 / 28%) 50%, rgb(255 255 255 / 0%) 60%);
  transform: translateX(-30%) rotate(-7deg);
  animation: sheen 2.6s linear infinite;
}

.face-art {
  width: 100%;
  height: 100%;
  display: block;
  background-image: url('/cards.png');
  background-repeat: no-repeat;
  background-size: calc(205px * var(--scale)) calc(49px * var(--scale));
  background-position: calc(-41px * var(--scale) * var(--card-index)) 0;
  image-rendering: pixelated;
}

.back-face {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 34%, rgb(249 211 120 / 16%) 0%, transparent 45%),
    repeating-linear-gradient(
    140deg,
    rgb(8 35 28 / 90%) 0,
    rgb(8 35 28 / 90%) 6px,
    rgb(3 19 16 / 96%) 6px,
    rgb(3 19 16 / 96%) 12px
    );
}

.back-face span {
  color: #f7db9f;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-shadow: 0 1px 0 rgb(0 0 0 / 45%);
}

figcaption {
  font-size: 0.68rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #f3d9a2;
  animation: caption-pulse 1.8s ease-in-out infinite;
}

@keyframes float {
0%,
100% {
  transform: translateY(0) rotate(0deg);
}
50% {
  transform: translateY(-4px) rotate(-1.2deg);
}
}

@keyframes reveal-snap {
  0% {
    transform: rotateY(-82deg) scale(0.96);
    filter: brightness(1.28) saturate(1.35);
  }
  52% {
    transform: rotateY(0deg) scale(1.035);
    filter: brightness(1.1) saturate(1.12);
  }
  100% {
    transform: rotateY(0deg) scale(1);
    filter: brightness(1) saturate(1);
  }
}

@keyframes swap-out {
  0% {
    transform: translateX(0) scale(1);
    opacity: 1;
    filter: brightness(1.08) saturate(1.05);
  }
  100% {
    transform: translateX(calc(-14px * var(--scale))) scale(0.97);
    opacity: 0;
    filter: brightness(0.92) saturate(0.95);
  }
}

@keyframes swap-in {
  0% {
    transform: translateX(calc(14px * var(--scale))) scale(0.97);
    opacity: 0;
    filter: brightness(1.2) saturate(1.18);
  }
  100% {
    transform: translateX(0) scale(1);
    opacity: 1;
    filter: brightness(1) saturate(1);
  }
}

@keyframes sheen {
  from {
    transform: translateX(-36%) rotate(-7deg);
  }
  to {
    transform: translateX(44%) rotate(-7deg);
  }
}

@keyframes caption-pulse {
  0%,
  100% {
    opacity: 0.9;
  }
  50% {
    opacity: 1;
  }
}
</style>
