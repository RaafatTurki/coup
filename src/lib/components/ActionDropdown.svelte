<script lang="ts">
import { Check, ChevronDown } from 'lucide-svelte';
import { onDestroy, onMount, tick } from 'svelte';
import type { GameActionType } from '$lib/game/types';

type ActionOption = {
  value: GameActionType;
  label: string;
  detail: string;
  disabled?: boolean;
};

let {
  value,
  options,
  disabled = false,
  onchange = () => {}
} = $props<{
  value: GameActionType;
  options: ActionOption[];
  disabled?: boolean;
  onchange?: (value: GameActionType) => void;
}>();

let root: HTMLDivElement;
let trigger: HTMLButtonElement;
let open = $state(false);

const selectedOption = $derived(options.find((option: ActionOption) => option.value === value) ?? options[0]);

function enabledItems(): HTMLButtonElement[] {
  return Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? []);
}

async function openMenu(focus: 'selected' | 'first' | 'last' = 'selected'): Promise<void> {
  if (disabled || open) {
    return;
  }

  open = true;
  await tick();
  const items = enabledItems();
  const selected = items.find((item) => item.dataset.value === value);
  const target = focus === 'first' ? items[0] : focus === 'last' ? items.at(-1) : selected ?? items[0];
  target?.focus();
}

function closeMenu(returnFocus = false): void {
  open = false;
  if (returnFocus) {
    void tick().then(() => trigger?.focus());
  }
}

function selectOption(option: ActionOption): void {
  if (option.disabled) {
    return;
  }

  onchange(option.value);
  closeMenu(true);
}

function handleTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    void openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
  }
}

function handleMenuKeydown(event: KeyboardEvent): void {
  const items = enabledItems();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex: number | null = null;

  if (event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % items.length;
  } else if (event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu(true);
    return;
  } else if (event.key === 'Tab') {
    closeMenu();
    return;
  }

  if (nextIndex !== null && items.length > 0) {
    event.preventDefault();
    items[nextIndex]?.focus();
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (open && root && !root.contains(event.target as Node)) {
    closeMenu();
  }
}

onMount(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown);
});

onDestroy(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
});

$effect(() => {
  if (disabled && open) {
    open = false;
  }
});
</script>

<div class="action-dropdown" bind:this={root}>
  <button
    bind:this={trigger}
    type="button"
    class="action-trigger"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="action-dropdown-menu"
    {disabled}
    onclick={() => (open ? closeMenu() : void openMenu())}
    onkeydown={handleTriggerKeydown}
  >
    <span class="trigger-copy">
      <span class="trigger-eyebrow">Action</span>
      <strong>{selectedOption?.label ?? 'Choose action'}</strong>
    </span>
    <ChevronDown class={open ? 'open' : undefined} size={17} aria-hidden="true" />
  </button>

  {#if open}
    <div
      id="action-dropdown-menu"
      class="action-menu"
      role="menu"
      aria-label="Choose an action"
      tabindex="-1"
      onkeydown={handleMenuKeydown}
    >
      {#each options as option (option.value)}
        <button
          type="button"
          class:selected={option.value === value}
          role="menuitemradio"
          aria-checked={option.value === value}
          data-value={option.value}
          disabled={option.disabled}
          onclick={() => selectOption(option)}
        >
          <span class="option-mark" aria-hidden="true">
            {#if option.value === value}<Check size={14} strokeWidth={2.5} />{/if}
          </span>
          <span class="option-copy">
            <strong>{option.label}</strong>
            <small>{option.detail}</small>
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
.action-dropdown {
  position: relative;
  z-index: 20;
  flex: 1 1 10.5rem;
  min-width: 9.5rem;
}

.action-trigger {
  width: 100%;
  min-height: 2.55rem;
  padding: 0.35rem 0.55rem 0.37rem 0.65rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  border: 1px solid rgb(248 204 111 / 42%);
  border-radius: 0.55rem;
  color: var(--ink);
  background:
    radial-gradient(circle at 12% 0%, rgb(248 204 111 / 10%) 0%, transparent 52%),
    linear-gradient(130deg, rgb(7 30 25 / 98%) 0%, rgb(2 13 11 / 98%) 100%);
  box-shadow:
    0 0 0 1px rgb(250 217 137 / 9%) inset,
    0 0.3rem 0.8rem rgb(0 0 0 / 20%);
  cursor: pointer;
  text-align: left;
}

.action-trigger:hover,
.action-trigger:focus-visible,
.action-trigger[aria-expanded='true'] {
  border-color: rgb(248 204 111 / 70%);
  box-shadow:
    0 0 0 1px rgb(250 217 137 / 13%) inset,
    0 0 0.9rem rgb(232 179 78 / 12%);
}

.action-trigger:focus-visible {
  outline: 2px solid rgb(248 210 126 / 58%);
  outline-offset: 2px;
}

.action-trigger:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

.trigger-copy {
  display: grid;
  gap: 0.05rem;
  min-width: 0;
}

.trigger-copy strong {
  overflow: hidden;
  color: #fff2ca;
  font-size: 0.88rem;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trigger-eyebrow {
  color: #d7ad5e;
  font-size: 0.57rem;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.action-trigger :global(svg) {
  flex: 0 0 auto;
  color: #e8bd67;
  transition: transform 150ms ease;
}

.action-trigger :global(svg.open) {
  transform: rotate(180deg);
}

.action-menu {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  z-index: 30;
  width: min(19rem, calc(100vw - 2rem));
  max-height: min(21rem, 60vh);
  overflow-y: auto;
  padding: 0.32rem;
  border: 1px solid rgb(248 204 111 / 38%);
  border-radius: 0.72rem;
  background:
    radial-gradient(circle at 12% 0%, rgb(248 204 111 / 12%) 0%, transparent 38%),
    linear-gradient(145deg, rgb(7 29 25 / 99%) 0%, rgb(2 13 11 / 99%) 100%);
  box-shadow:
    0 1rem 2.2rem rgb(0 0 0 / 52%),
    0 0 0 1px rgb(250 221 151 / 8%) inset;
  animation: menu-enter 130ms ease-out;
}

.action-menu button {
  width: 100%;
  padding: 0.46rem 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.48rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  color: #eadcb9;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.action-menu button:hover:not(:disabled),
.action-menu button:focus-visible:not(:disabled) {
  outline: none;
  border-color: rgb(248 204 111 / 28%);
  color: #fff2ca;
  background: rgb(248 204 111 / 9%);
}

.action-menu button.selected {
  border-color: rgb(139 233 186 / 28%);
  background: linear-gradient(110deg, rgb(36 105 80 / 24%), rgb(248 204 111 / 5%));
}

.action-menu button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.option-mark {
  flex: 0 0 1.35rem;
  display: grid;
  place-items: center;
  color: #8be9ba;
}

.option-copy {
  display: grid;
  gap: 0.06rem;
}

.option-copy strong {
  color: inherit;
  font-size: 0.82rem;
  line-height: 1.1;
}

.option-copy small {
  color: #b9ab87;
  font-size: 0.67rem;
  line-height: 1.25;
}

@keyframes menu-enter {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.99);
  }
}

@media (prefers-reduced-motion: reduce) {
  .action-menu,
  .action-trigger :global(svg) {
    animation: none;
    transition: none;
  }
}
</style>
