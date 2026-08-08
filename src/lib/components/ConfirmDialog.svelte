<script lang="ts">
import { TriangleAlert, X } from 'lucide-svelte';

let {
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel
} = $props<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}>();

let dialog: HTMLDialogElement;
let cancelButton: HTMLButtonElement;

$effect(() => {
  if (open && !dialog.open) {
    dialog.showModal();
    cancelButton.focus();
  } else if (!open && dialog.open) {
    dialog.close();
  }
});

function handleCancel(event: Event): void {
  event.preventDefault();
  onCancel();
}

function handleBackdropClick(event: MouseEvent): void {
  if (event.target !== event.currentTarget) {
    return;
  }

  const bounds = dialog.getBoundingClientRect();
  const clickedOutside =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom;

  if (clickedOutside) {
    onCancel();
  }
}
</script>

<dialog
  bind:this={dialog}
  class="confirm-dialog"
  aria-labelledby="confirm-dialog-title"
  aria-describedby="confirm-dialog-message"
  oncancel={handleCancel}
  onclick={handleBackdropClick}
>
  <button type="button" class="close-button" aria-label="Cancel" onclick={onCancel}>
    <X size={17} aria-hidden="true" />
  </button>

  <div class="warning-mark" aria-hidden="true">
    <TriangleAlert size={24} />
  </div>

  <div class="dialog-copy">
    <p class="eyebrow">Confirm action</p>
    <h2 id="confirm-dialog-title">{title}</h2>
    <p id="confirm-dialog-message">{message}</p>
  </div>

  <div class="dialog-actions">
    <button bind:this={cancelButton} type="button" class="btn btn-secondary" onclick={onCancel}>Keep playing</button>
    <button type="button" class="btn btn-danger" onclick={onConfirm}>{confirmLabel}</button>
  </div>
</dialog>

<style>
.confirm-dialog {
  width: min(calc(100vw - 2rem), 25rem);
  margin: auto;
  padding: 1.15rem;
  border: 1px solid rgb(248 204 111 / 36%);
  border-radius: 1rem;
  color: var(--ink);
  background:
    radial-gradient(circle at 12% 5%, rgb(248 204 111 / 14%) 0%, transparent 38%),
    linear-gradient(145deg, rgb(8 31 26 / 99%) 0%, rgb(3 15 13 / 99%) 100%);
  box-shadow:
    0 1.4rem 3.5rem rgb(0 0 0 / 55%),
    0 0 0 1px rgb(250 221 151 / 10%) inset;
  animation: dialog-enter 160ms ease-out;
}

.confirm-dialog::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  border-radius: 1rem 1rem 0 0;
  background: linear-gradient(90deg, transparent, rgb(244 203 112 / 82%), transparent);
}

.confirm-dialog::backdrop {
  background: rgb(1 8 7 / 72%);
  backdrop-filter: blur(4px);
  animation: backdrop-enter 140ms ease-out;
}

.close-button {
  position: absolute;
  top: 0.7rem;
  right: 0.7rem;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 1px solid rgb(248 204 111 / 24%);
  border-radius: 999px;
  color: #e8d5aa;
  background: rgb(2 14 12 / 62%);
  cursor: pointer;
}

.close-button:hover,
.close-button:focus-visible {
  color: #fff2ca;
  border-color: rgb(248 204 111 / 52%);
}

.warning-mark {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  margin-bottom: 0.8rem;
  border: 1px solid rgb(242 151 141 / 35%);
  border-radius: 0.8rem;
  color: #f4b9ae;
  background: rgb(80 23 18 / 42%);
  box-shadow: 0 0 1.4rem rgb(166 58 44 / 14%);
}

.dialog-copy {
  padding-right: 1.5rem;
}

.eyebrow {
  margin: 0 0 0.28rem;
  color: #e8bd67;
  font-size: 0.68rem;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  color: #fff2ca;
  font-size: 1.18rem;
  line-height: 1.25;
}

#confirm-dialog-message {
  margin: 0.55rem 0 0;
  color: #e6d7b0;
  font-size: 0.9rem;
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.15rem;
}

.dialog-actions .btn {
  --btn-padding: 0.52rem 0.76rem;
}

@media (max-width: 24rem) {
  .dialog-actions {
    display: grid;
  }

  .dialog-actions .btn {
    width: 100%;
  }
}

@keyframes dialog-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}

@keyframes backdrop-enter {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .confirm-dialog,
  .confirm-dialog::backdrop {
    animation: none;
  }
}
</style>
