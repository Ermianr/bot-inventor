<script lang="ts">
  import { run } from "../app/run.svelte";
  import { atEnd, formatTime, where } from "../editor/logs";
  import type { LogLevel } from "../lib/bindings";
  import { m } from "../paraglide/messages.js";

  let list = $state<HTMLElement>();
  /** The panel follows the newest line until the person scrolls up. */
  let following = $state(true);

  function onscroll(): void {
    if (list === undefined) return;
    following = atEnd(list.scrollTop, list.scrollHeight, list.clientHeight);
  }

  function jump(): void {
    following = true;
    if (list !== undefined) list.scrollTop = list.scrollHeight;
  }

  // Runs after the new rows are in the page.
  $effect(() => {
    void run.log.next;
    if (following && list !== undefined) list.scrollTop = list.scrollHeight;
  });

  function label(level: LogLevel): string {
    switch (level) {
      case "info":
        return m.level_info();
      case "warn":
        return m.level_warn();
      case "error":
        return m.level_error();
    }
  }
</script>

<section class="log" class:collapsed={!run.logOpen} aria-label={m.log_title()}>
  <header>
    <h2>{m.log_title()}</h2>
    <span class="count">{m.log_count({ count: run.log.entries.length })}</span>
    <span class="spacer"></span>
    {#if run.logOpen && !following && run.log.entries.length > 0}
      <button type="button" onclick={jump}>{m.log_jump()}</button>
    {/if}
    <button
      type="button"
      onclick={() => {
        run.clear();
      }}
      disabled={run.log.entries.length === 0}
    >
      {m.log_clear()}
    </button>
    <button
      type="button"
      aria-expanded={run.logOpen}
      aria-controls="bot-log"
      onclick={() => {
        run.logOpen = !run.logOpen;
      }}
    >
      {run.logOpen ? m.log_collapse() : m.log_expand()}
    </button>
  </header>
  <!-- A region that scrolls must be reachable with the keyboard, or its lines cannot be read. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    id="bot-log"
    class="rows"
    role="log"
    aria-live="off"
    aria-label={m.log_title()}
    tabindex="0"
    hidden={!run.logOpen}
    bind:this={list}
    {onscroll}
  >
    {#if run.log.dropped > 0}
      <p class="note">{m.log_dropped({ count: run.log.dropped })}</p>
    {/if}
    {#if run.log.entries.length === 0}
      <p class="note">{m.log_empty()}</p>
    {/if}
    {#each run.log.entries as entry (entry.seq)}
      <div class="row {entry.line.level}">
        <time>{formatTime(entry.line.ts)}</time>
        <span class="level">{label(entry.line.level)}</span>
        <span class="source">{entry.line.source}</span>
        <span class="where">{where(entry.line)}</span>
        <span class="msg">{entry.line.msg}</span>
      </div>
    {/each}
  </div>
</section>

<style>
  .log {
    display: flex;
    flex-direction: column;
    height: 12rem;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  .log.collapsed {
    height: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0;
    color: var(--muted);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .count {
    color: var(--muted);
    font-size: 0.75rem;
  }
  .spacer {
    flex: 1;
  }
  .rows {
    flex: 1;
    min-height: 0;
    padding: 0.25rem 0;
    overflow-y: auto;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
  }
  .rows[hidden] {
    display: none;
  }
  .note {
    margin: 0;
    padding: 0.25rem 1rem;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 0.625rem;
    padding: 0.0625rem 1rem;
    overflow-wrap: anywhere;
  }
  .row.warn {
    background: var(--surface-2);
    color: var(--warning);
  }
  .row.error {
    background: var(--danger-soft);
    color: var(--danger);
  }
  time,
  .source,
  .where {
    flex: none;
    color: var(--muted);
  }
  .row.warn .source,
  .row.warn .where,
  .row.warn time {
    color: inherit;
  }
  .row.error .source,
  .row.error .where,
  .row.error time {
    color: inherit;
  }
  .level {
    flex: none;
    width: 3.25rem;
    font-weight: 700;
  }
  .msg {
    min-width: 0;
    white-space: pre-wrap;
  }
</style>
