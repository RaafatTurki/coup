<script lang="ts">
import type { InfluenceCard } from '$lib/game/types';

type CardDetails = {
  quote: string;
  abilities: string[];
};

const CARD_INDEX: Record<InfluenceCard, number> = {
  duke: 0,
  contessa: 1,
  captain: 2,
  assassin: 3,
  ambassador: 4
};

const CARD_LABEL: Record<InfluenceCard, string> = {
  duke: 'Duke',
  contessa: 'Contessa',
  captain: 'Captain',
  assassin: 'Assassin',
  ambassador: 'Ambassador'
};

const CARD_DETAILS: Record<InfluenceCard, CardDetails> = {
  duke: {
    quote: 'Gold obeys me, and so will you.',
    abilities: ['Take Tax. (+3 coins)', 'Block Aid.']
  },
  contessa: {
    quote: 'I am the reason assassins charge extra.',
    abilities: ['Block Assassination.']
  },
  captain: {
    quote: 'I collect debt in screams.',
    abilities: ['Steal up to 2 coins from a player.', 'Block stealing.']
  },
  assassin: {
    quote: 'I do not threaten. I subtract.',
    abilities: ['Assassinate a card (-3 coins).']
  },
  ambassador: {
    quote: 'You guard your coin; I rewrite your options.',
    abilities: ['Exchange cards with the deck.', 'Block stealing.']
  }
};

let { card, onClose } = $props<{
  card: InfluenceCard | null;
  onClose: () => void;
}>();

const spotlight = $derived.by(() => {
  if (!card) {
    return null;
  }

  const activeCard = card as InfluenceCard;
  return {
    card: activeCard,
    label: CARD_LABEL[activeCard],
    index: CARD_INDEX[activeCard],
    details: CARD_DETAILS[activeCard]
  };
});

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && card) {
    event.preventDefault();
    onClose();
  }
}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if spotlight}
  <button
    type="button"
    class="spotlight-backdrop"
    aria-label="Close card spotlight"
    onclick={onClose}
  ></button>

  <dialog
    class={`spotlight-panel role-${spotlight.card}`}
    aria-label={`${spotlight.label} spotlight`}
    open
  >
    <button type="button" class="spotlight-close" aria-label="Close spotlight" onclick={onClose}>
      Close
    </button>

    <div class="spotlight-content">
      <div class="spotlight-card-art" style={`--card-index:${spotlight.index};`}></div>

      <div class="spotlight-copy">
        <p class="spotlight-name">{spotlight.label}</p>
        <p class="spotlight-quote">“{spotlight.details.quote}”</p>
        <ul>
          {#each spotlight.details.abilities as ability}
            <li>{ability}</li>
          {/each}
        </ul>
        <p class="spotlight-hint">Press escape or click outside to return</p>
      </div>
    </div>
  </dialog>
{/if}

<style>
.spotlight-backdrop {
  position: fixed;
  inset: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: rgb(1 8 7 / 64%);
  backdrop-filter: blur(4px);
  z-index: 34;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.spotlight-panel {
  position: fixed;
  left: 50%;
  top: 50%;
  width: min(94vw, 940px);
  max-height: min(94svh, 680px);
  transform: translate(-50%, -50%);
  border: 1px solid rgb(248 219 152 / 22%);
  border-radius: clamp(0.85rem, 2.8vw, 1.25rem);
  padding: clamp(1rem, 4.8vw, 2.4rem);
  z-index: 36;
  overflow: auto;
  background:
    radial-gradient(circle at 11% 15%, var(--tint-a) 0%, transparent 45%),
    radial-gradient(circle at 85% 84%, rgb(250 218 142 / 9%) 0%, transparent 36%),
    linear-gradient(154deg, var(--tint-b) 0%, rgb(2 12 10 / 98%) 100%);
  box-shadow:
    0 1rem 2.2rem rgb(0 0 0 / 42%),
    0 0 0 1px rgb(249 223 165 / 16%) inset;
}

.role-duke {
  --tint-a: rgb(255 206 112 / 34%);
  --tint-b: rgb(42 24 5 / 96%);
}

.role-contessa {
  --tint-a: rgb(247 171 142 / 34%);
  --tint-b: rgb(39 15 12 / 96%);
}

.role-captain {
  --tint-a: rgb(130 201 218 / 31%);
  --tint-b: rgb(8 26 39 / 96%);
}

.role-assassin {
  --tint-a: rgb(237 123 121 / 33%);
  --tint-b: rgb(34 10 15 / 96%);
}

.role-ambassador {
  --tint-a: rgb(142 218 173 / 32%);
  --tint-b: rgb(7 33 22 / 96%);
}

.spotlight-close {
  position: absolute;
  right: 0.85rem;
  top: 0.75rem;
  font: inherit;
  border-radius: 999px;
  border: 1px solid rgb(248 204 111 / 42%);
  background: rgb(3 16 14 / 88%);
  color: #f2ddb1;
  padding: 0.25rem 0.62rem;
  cursor: pointer;
}

.spotlight-content {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: clamp(1rem, 4vw, 3rem);
}

.spotlight-card-art {
  width: clamp(9.2rem, 25vw, 14rem);
  aspect-ratio: 88 / 106;
  border-radius: 1rem;
  border: 1px solid rgb(251 223 162 / 42%);
  background: url('/cards.png');
  background-repeat: no-repeat;
  background-size: calc(100% * 5) 100%;
  background-position: calc(var(--card-index) * 25%) 0;
  image-rendering: pixelated;
  box-shadow:
    0 0.85rem 1.6rem rgb(0 0 0 / 36%),
    0 0 0 1px rgb(252 226 174 / 16%) inset;
}

.spotlight-copy {
  color: #f8e7c1;
  max-width: min(54ch, 100%);
  text-align: center;
  animation: spotlight-copy-enter 220ms ease-out both;
}

.spotlight-name {
  margin: 0;
  font-size: clamp(1.35rem, 4.3vw, 2rem);
  line-height: 1.08;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #fff0cf;
}

.spotlight-quote {
  margin: 0.52rem auto 0;
  line-height: 1.45;
  max-width: 54ch;
  color: #f3ddaf;
  font-style: italic;
}

.spotlight-copy ul {
  margin: 0.8rem 0 0;
  padding-left: 0;
  list-style-position: inside;
  text-align: left;
  width: min(52ch, 100%);
  display: grid;
  gap: 0.38rem;
  color: #f5dfb2;
}

.spotlight-hint {
  font-size: 0.72rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #f4d18b;
}

@media (max-width: 46rem) {
  .spotlight-content {
    grid-template-columns: 1fr;
    justify-items: center;
  }

  .spotlight-close {
    right: 0.6rem;
    top: 0.5rem;
  }
}

@keyframes spotlight-copy-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
