<script lang="ts">
import { goto } from '$app/navigation';
import { normalizeGameId, rememberPlayer } from '$lib/game/client';
import { messageFromError, requestJson } from '$lib/game/http';

type LobbyPayload = {
  gameId: string;
  playerId: string;
};

type InfluenceCardLabel = 'Duke' | 'Contessa' | 'Captain' | 'Assassin' | 'Ambassador';

type PreviewCard = {
  label: InfluenceCardLabel;
  index: number;
  shift: string;
  lift: string;
  tilt: string;
};

type CardDetails = {
  quote: string;
  abilities: string[];
};

const PREVIEW_CARDS: PreviewCard[] = [
  { label: 'Duke', index: 0, shift: '-7.4rem', lift: '1.2rem', tilt: '-18deg' },
  { label: 'Contessa', index: 1, shift: '-3.9rem', lift: '0.45rem', tilt: '-9deg' },
  { label: 'Captain', index: 2, shift: '0rem', lift: '0rem', tilt: '0deg' },
  { label: 'Assassin', index: 3, shift: '3.9rem', lift: '0.45rem', tilt: '9deg' },
  { label: 'Ambassador', index: 4, shift: '7.4rem', lift: '1.2rem', tilt: '18deg' }
];

const CARD_INDEX: Record<InfluenceCardLabel, number> = {
  Duke: 0,
  Contessa: 1,
  Captain: 2,
  Assassin: 3,
  Ambassador: 4
};

const CARD_DETAILS: Record<InfluenceCardLabel, CardDetails> = {
  Duke: {
    quote: 'Gold obeys me, and so will you.',
    abilities: ['Take Tax. (+3 coins)', 'Block Aid.']
  },
  Contessa: {
    quote: 'I am the reason assassins charge extra.',
    abilities: ['Block Assassination.']
  },
  Captain: {
    quote: 'I collect debt in screams.',
    abilities: ['Steal up to 2 coins from a player.', 'Block stealing.']
  },
  Assassin: {
    quote: 'I do not threaten. I subtract.',
    abilities: ['Assassinate a card (-3 coins).']
  },
  Ambassador: {
    quote: 'You guard your coin; I rewrite your options.',
    abilities: ['Exchange cards with the deck.', 'Block stealing.']
  }
};

let playerName = $state('');
let gameIdInput = $state('');
let pending = $state(false);
let errorMessage = $state('');
let spotlightCard = $state<InfluenceCardLabel | null>(null);

function postLobby(url: string, body: unknown, fallbackError: string): Promise<LobbyPayload> {
  return requestJson<LobbyPayload>(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    },
    fallbackError
  );
}

async function createGame(): Promise<void> {
  errorMessage = '';
  pending = true;

  try {
    const payload = await postLobby(
      '/api/games',
      { name: playerName },
      'Unable to create game.'
    );
    rememberPlayer(payload.gameId, payload.playerId);
    await goto(`/game/${payload.gameId}`);
  } catch (error) {
    errorMessage = messageFromError(error, 'Unable to create game.');
  } finally {
    pending = false;
  }
}

async function joinGame(): Promise<void> {
  errorMessage = '';
  pending = true;

  try {
    const gameId = normalizeGameId(gameIdInput);
    const payload = await postLobby(
      `/api/games/${gameId}/join`,
      { name: playerName },
      'Unable to join game.'
    );
    rememberPlayer(payload.gameId, payload.playerId);
    await goto(`/game/${payload.gameId}`);
  } catch (error) {
    errorMessage = messageFromError(error, 'Unable to join game.');
  } finally {
    pending = false;
  }
}

function openSpotlight(label: InfluenceCardLabel): void {
  spotlightCard = label;
}

function closeSpotlight(): void {
  spotlightCard = null;
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && spotlightCard) {
    event.preventDefault();
    closeSpotlight();
  }
}
</script>

<svelte:head>
  <title>Coup Lobby</title>
</svelte:head>
<svelte:window onkeydown={handleGlobalKeydown} />

<main class="lobby">
  <section class="table-card panel-base">
    <div class="intro">
      <p class="eyebrow">LOBBY</p>
      <p class="copy">Click any of the cards below for a spotlight.</p>
    </div>

    <div class="table-preview">
      <div class="felt-glow"></div>

      {#each PREVIEW_CARDS as card, index (card.label)}
        <button
          type="button"
          class={`preview-card role-${card.label.toLowerCase()}`}
          style={`--card-index:${card.index};--shift:${card.shift};--lift:${card.lift};--tilt:${card.tilt};--delay:${index * 70}ms;`}
          aria-label={`Show ${card.label} abilities`}
          aria-expanded={spotlightCard === card.label}
          onclick={() => openSpotlight(card.label)}
        >
          <div class="card-art"></div>
        </button>
      {/each}
    </div>

    <div class="controls">
      <div class="form-grid">
        <label class="field">
          <span>Player name</span>
          <input class="input-base" bind:value={playerName} maxlength="24" placeholder="Your alias" disabled={pending} />
        </label>
        <button
          type="button"
          class="action create btn"
          onclick={createGame}
          disabled={pending || !playerName.trim()}
        >
          {pending ? 'Working...' : 'Create'}
        </button>

        <label class="field">
          <span>Table code</span>
          <input
            class="input-base"
            bind:value={gameIdInput}
            maxlength="8"
            placeholder="AB12CD"
            disabled={pending}
            oninput={() => {
              gameIdInput = normalizeGameId(gameIdInput);
            }}
          />
        </label>
        <button
          type="button"
          class="action join btn btn-secondary"
          onclick={joinGame}
          disabled={pending || !playerName.trim() || !gameIdInput.trim()}
        >
          Join
        </button>
      </div>

      {#if errorMessage}
        <p class="error-text">{errorMessage}</p>
      {/if}
    </div>
  </section>

  {#if spotlightCard}
    <button
      type="button"
      class="spotlight-backdrop open"
      aria-label="Close card spotlight"
      onclick={closeSpotlight}
    ></button>

    <dialog
      class={`spotlight-panel role-${spotlightCard.toLowerCase()}`}
      aria-label={`${spotlightCard} spotlight`}
      open
    >
      <button type="button" class="spotlight-close" aria-label="Close spotlight" onclick={closeSpotlight}>
        Close
      </button>

      <div class="spotlight-content">
        <div class="spotlight-card-art" style={`--card-index:${CARD_INDEX[spotlightCard]};`}></div>

        <div class="spotlight-copy">
          <p class="spotlight-name">{spotlightCard}</p>
          <p class="spotlight-quote">"{CARD_DETAILS[spotlightCard].quote}"</p>
          <ul>
            {#each CARD_DETAILS[spotlightCard].abilities as ability}
              <li>{ability}</li>
            {/each}
          </ul>
          <p class="spotlight-hint">Press escape or click outside to return</p>
        </div>
      </div>
    </dialog>
  {/if}
</main>

<style>
.lobby {
  min-height: 100svh;
  padding: 0.75rem;
  display: grid;
  place-items: center;
}

.table-card {
  --panel-base-radius: 1rem;
  --panel-base-padding: 0.85rem;
  --panel-base-background:
    radial-gradient(circle at 15% 10%, rgb(249 209 118 / 11%) 0%, transparent 35%),
    linear-gradient(150deg, rgb(6 27 23 / 96%) 0%, rgb(3 15 13 / 98%) 100%);
  --panel-base-shadow:
    0 0.75rem 1.8rem rgb(0 0 0 / 30%),
    0 0 0 1px rgb(251 218 138 / 10%) inset;
  width: min(100%, 28rem);
  display: grid;
  gap: 0.85rem;
}

.intro {
  display: grid;
  gap: 0.38rem;
}

.eyebrow {
  margin: 0;
  font-size: 0.68rem;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: #efc874;
}

.copy {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.35;
  color: #eeddb8;
  max-width: 52ch;
}

.table-preview {
  position: relative;
  height: 10.4rem;
  border-radius: 0.85rem;
  border: 1px solid rgb(246 203 109 / 20%);
  background:
    radial-gradient(circle at 48% 8%, rgb(248 205 108 / 18%) 0%, transparent 43%),
    linear-gradient(155deg, rgb(4 22 18 / 84%) 0%, rgb(2 13 11 / 88%) 100%);
  overflow: hidden;
  display: grid;
  place-items: center;
}

.felt-glow {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 35%, rgb(250 215 134 / 9%) 0%, transparent 40%),
    repeating-linear-gradient(
      135deg,
      rgb(250 216 136 / 2%) 0,
      rgb(250 216 136 / 2%) 7px,
      rgb(0 0 0 / 0%) 7px,
      rgb(0 0 0 / 0%) 14px
    );
  pointer-events: none;
}

.preview-card {
  --tint-a: rgb(245 202 110 / 30%);
  --tint-b: rgb(5 26 22 / 96%);
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  position: absolute;
  top: 1.3rem;
  left: 50%;
  width: 88px;
  transform: translateX(calc(-50% + var(--shift))) translateY(var(--lift)) rotate(var(--tilt));
  z-index: 2;
  animation: card-deal 820ms cubic-bezier(0.19, 1, 0.22, 1) both;
  animation-delay: var(--delay);
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  overflow: visible;
}

.preview-card:focus-visible {
  outline: 2px solid rgb(248 220 158 / 72%);
  outline-offset: 5px;
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

.card-art {
  width: 100%;
  aspect-ratio: 88 / 106;
  border-radius: 0.8rem;
  border: 1px solid rgb(245 201 101 / 52%);
  background: url('/cards.png');
  background-repeat: no-repeat;
  background-size: calc(100% * 5) 100%;
  background-position: calc(var(--card-index) * 25%) 0;
  image-rendering: pixelated;
  box-shadow:
    0 0.38rem 0.86rem rgb(0 0 0 / 30%),
    0 0 0 1px rgb(248 220 158 / 14%) inset;
  animation: card-bob 2.6s ease-in-out infinite;
  animation-delay: calc(var(--delay) * -1);
}

.controls {
  display: grid;
  gap: 0.62rem;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
}

.field {
  display: grid;
  gap: 0.24rem;
}

.field span {
  font-size: 0.68rem;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: #edcb82;
}

.action {
  align-self: end;
}

.action.join {
  --btn-secondary-fg: #f2ddb1;
}

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

@media (max-width: 27rem) {
  .lobby {
    padding: 0.6rem;
  }

  .table-card {
    width: 100%;
    padding: 0.72rem;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .action {
    width: 100%;
  }
}

@keyframes card-deal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes card-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-7px);
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
