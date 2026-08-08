<script lang="ts">
import { goto } from '$app/navigation';
import CardSpotlight from '$lib/components/CardSpotlight.svelte';
import { normalizeGameId, rememberPlayer } from '$lib/game/client';
import { messageFromError, requestJson } from '$lib/game/http';
import type { InfluenceCard } from '$lib/game/types';

type LobbyPayload = {
  gameId: string;
  playerId: string;
};

type PreviewCard = {
  card: InfluenceCard;
  label: string;
  index: number;
  shift: string;
  lift: string;
  tilt: string;
};

const PREVIEW_CARDS: PreviewCard[] = [
  { card: 'duke', label: 'Duke', index: 0, shift: '-7.4rem', lift: '1.2rem', tilt: '-18deg' },
  { card: 'contessa', label: 'Contessa', index: 1, shift: '-3.9rem', lift: '0.45rem', tilt: '-9deg' },
  { card: 'captain', label: 'Captain', index: 2, shift: '0rem', lift: '0rem', tilt: '0deg' },
  { card: 'assassin', label: 'Assassin', index: 3, shift: '3.9rem', lift: '0.45rem', tilt: '9deg' },
  { card: 'ambassador', label: 'Ambassador', index: 4, shift: '7.4rem', lift: '1.2rem', tilt: '18deg' }
];

let playerName = $state('');
let gameIdInput = $state('');
let pending = $state(false);
let errorMessage = $state('');
let spotlightCard = $state<InfluenceCard | null>(null);

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

function openSpotlight(card: InfluenceCard): void {
  spotlightCard = card;
}

function closeSpotlight(): void {
  spotlightCard = null;
}

</script>

<svelte:head>
  <title>Coup Lobby</title>
</svelte:head>
<main class="lobby">
  <section class="table-card panel-base">
    <div class="intro">
      <p class="eyebrow">LOBBY</p>
      <p class="copy">Click any of the cards below for a spotlight.</p>
    </div>

    <div class="table-preview">
      <div class="felt-glow"></div>

      {#each PREVIEW_CARDS as card, index (card.card)}
        <button
          type="button"
          class={`preview-card role-${card.card}`}
          style={`--card-index:${card.index};--shift:${card.shift};--lift:${card.lift};--tilt:${card.tilt};--delay:${index * 70}ms;`}
          aria-label={`Show ${card.label} abilities`}
          aria-expanded={spotlightCard === card.card}
          onclick={() => openSpotlight(card.card)}
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

  <CardSpotlight card={spotlightCard} onClose={closeSpotlight} />
</main>

<style>
.lobby {
  --asset-build-marker: 1;
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

</style>
