<script lang="ts">
  import { SvelteFlowProvider } from "@xyflow/svelte";
  import { appInfo } from "./app/appInfo.svelte";
  import { editor } from "./app/editor.svelte";
  import FlowCanvas from "./components/FlowCanvas.svelte";
  import FlowList from "./components/FlowList.svelte";
  import NewProjectForm from "./components/NewProjectForm.svelte";
  import PropertyPanel from "./components/PropertyPanel.svelte";
  import { m } from "./paraglide/messages.js";

  let creating = $state(false);

  appInfo.load();
  editor.loadCatalog();

  function onkeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      editor.save();
    } else if (key === "z" && !event.shiftKey) {
      // Also inside a text field: what is typed there is already part of the project.
      event.preventDefault();
      editor.undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      editor.redo();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="app">
  <header>
    <h1>{m.app_title()}</h1>
    <button
      type="button"
      onclick={() => {
        creating = !creating;
      }}
      disabled={editor.busy}
    >
      {m.toolbar_new()}
    </button>
    <button
      type="button"
      onclick={() => {
        editor.openProject();
      }}
      disabled={editor.busy}
    >
      {m.toolbar_open()}
    </button>
    {#if editor.project !== null}
      <button
        type="button"
        class="primary"
        onclick={() => {
          editor.save();
        }}
        disabled={editor.busy || !editor.dirty}
      >
        {editor.busy ? m.toolbar_saving() : m.toolbar_save()}
      </button>
      <button
        type="button"
        onclick={() => {
          editor.undo();
        }}
        disabled={!editor.canUndo}
      >
        {m.toolbar_undo()}
      </button>
      <button
        type="button"
        onclick={() => {
          editor.redo();
        }}
        disabled={!editor.canRedo}
      >
        {m.toolbar_redo()}
      </button>
      <span class="project">{editor.project.manifest.name}</span>
      <span class="status" class:unsaved={editor.dirty}>
        {editor.dirty ? m.status_unsaved() : m.status_saved()}
      </span>
      <span
        class="problems"
        class:failing={editor.totals.errors > 0}
        class:warned={editor.totals.errors === 0 && editor.totals.warnings > 0}
      >
        {editor.totals.errors + editor.totals.warnings === 0
          ? m.problems_none()
          : m.problems_count({
              errors: editor.totals.errors,
              warnings: editor.totals.warnings,
            })}
      </span>
    {/if}
  </header>

  {#if creating}
    <NewProjectForm
      onsubmit={(name: string) => {
        creating = false;
        editor.newProject(name);
      }}
      oncancel={() => {
        creating = false;
      }}
    />
  {/if}

  {#if editor.notice !== null}
    <div
      class="notice"
      class:error={editor.notice.kind === "error"}
      role="alert"
    >
      <span>{editor.notice.text}</span>
      <button
        type="button"
        onclick={() => {
          editor.dismissNotice();
        }}
      >
        {m.notice_close()}
      </button>
    </div>
  {/if}

  {#if editor.project === null}
    <main class="welcome">
      <h2>{m.welcome_title()}</h2>
      <p>{m.welcome_text()}</p>
      {#if appInfo.state.status === "ready"}
        <p class="version">
          {m.welcome_version({ version: appInfo.state.info.version })}
        </p>
      {/if}
    </main>
  {:else}
    <div class="body">
      <aside><FlowList /></aside>
      <main>
        {#if editor.flow !== null}
          {#key editor.flowName}
            <SvelteFlowProvider><FlowCanvas /></SvelteFlowProvider>
          {/key}
        {/if}
      </main>
      <PropertyPanel />
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  h1 {
    margin: 0 0.75rem 0 0;
    font-size: 1rem;
  }
  .project {
    margin-left: 0.75rem;
    font-weight: 600;
  }
  .status {
    color: var(--muted);
    font-size: 0.8125rem;
  }
  .status.unsaved {
    color: var(--warning);
  }
  .problems {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.8125rem;
  }
  .problems.failing {
    color: var(--danger);
  }
  .problems.warned {
    color: var(--warning);
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--accent-soft);
  }
  .notice.error {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .body {
    display: grid;
    flex: 1;
    grid-template-columns: 13rem minmax(0, 1fr) 20rem;
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
  }
  aside {
    border-right: 1px solid var(--border);
    background: var(--surface);
    overflow-y: auto;
  }
  main {
    min-width: 0;
    min-height: 0;
  }
  .welcome {
    flex: 1;
    display: grid;
    place-content: center;
    gap: 0.25rem;
    text-align: center;
  }
  .welcome h2 {
    margin: 0;
  }
  .welcome p {
    margin: 0;
    color: var(--muted);
  }
</style>
