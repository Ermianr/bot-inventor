<script lang="ts">
  import { appInfo } from "./app/appInfo.svelte";

  appInfo.load();
</script>

<main>
  <h1>Bot Inventor</h1>
  {#if appInfo.state.status === "ready"}
    <p>Version {appInfo.state.info.version}</p>
  {:else if appInfo.state.status === "failed"}
    <p>The backend did not answer.</p>
  {/if}
</main>

<style>
  main {
    font-family: system-ui, sans-serif;
    padding: 2rem;
  }
</style>
