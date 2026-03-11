<script lang="ts">
import '../app.css';

let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href="/favicon.svg" />
</svelte:head>

<div class="app-shell">
  {@render children()}
</div>

<style>
.app-shell {
  min-height: 100svh;
}
</style>
