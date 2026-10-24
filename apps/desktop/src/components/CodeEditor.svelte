<script lang="ts">
  import {
    autocompletion,
    type CompletionContext,
    type CompletionResult,
  } from "@codemirror/autocomplete";
  import { defaultKeymap } from "@codemirror/commands";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { onMount } from "svelte";
  import type { NameInfo } from "../lib/bindings";
  import { m } from "../paraglide/messages.js";

  let {
    value,
    label = m.code_editor_label(),
    names = [],
    invalid = false,
    onchange,
  }: {
    value: string;
    label?: string;
    names?: readonly NameInfo[];
    invalid?: boolean;
    onchange: (text: string) => void;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  // The names a person can type, from the list of the node. The history of the project is the
  // only undo (App.svelte), so this editor has none of its own.
  function complete(context: CompletionContext): CompletionResult | null {
    const word = context.matchBefore(/[\w.]*/);
    if (word === null || (word.from === word.to && !context.explicit)) {
      return null;
    }
    return {
      from: word.from,
      options: names.map((name) => ({
        label: name.source,
        type: "variable",
        detail: name.kind.toLowerCase(),
      })),
      validFor: /^[\w.]*$/,
    };
  }

  const theme = EditorView.theme({
    "&": {
      border: "1px solid var(--editor-border, var(--border))",
      borderRadius: "0.375rem",
      background: "var(--surface)",
      color: "var(--text)",
      fontSize: "0.8125rem",
    },
    "&.cm-focused": { outline: "2px solid var(--accent)" },
    ".cm-content": {
      padding: "0.3125rem 0.5rem",
      fontFamily: "ui-monospace, monospace",
      caretColor: "var(--text)",
    },
    ".cm-tooltip": {
      border: "1px solid var(--border)",
      background: "var(--surface)",
      color: "var(--text)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      background: "var(--accent-soft)",
      color: "var(--text)",
    },
  });

  // CodeMirror writes its styles into a `<style>` element, which the CSP of the app (`style-src
  // 'self'`) does not allow. In a shadow root it uses a constructed stylesheet instead, which the
  // CSP does not touch, so the editor lives in one. Custom properties and the font still reach it.
  onMount(() => {
    const root = host.attachShadow({ mode: "open" });
    const parent = document.createElement("div");
    root.append(parent);
    view = new EditorView({
      root,
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          keymap.of(defaultKeymap),
          autocompletion({ override: [complete] }),
          EditorView.lineWrapping,
          theme,
          EditorView.contentAttributes.of({
            "aria-label": label,
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onchange(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => {
      view?.destroy();
      view = undefined;
    };
  });

  // The text changed from outside (an undo, a redo, the builder): show it, leaving what the
  // person typed alone when it is already the same.
  $effect(() => {
    const current = view?.state.doc.toString();
    if (view !== undefined && current !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  });
</script>

<div class="code" class:invalid bind:this={host}></div>

<style>
  .code {
    font: inherit;
  }
  .invalid {
    --editor-border: var(--danger);
  }
</style>
