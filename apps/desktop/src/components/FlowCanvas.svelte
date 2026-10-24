<script lang="ts">
  import {
    Background,
    Controls,
    SvelteFlow,
    useSvelteFlow,
    type Connection,
    type Edge,
    type Node,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { untrack } from "svelte";
  import { editor } from "../app/editor.svelte";
  import {
    lineOfEdge,
    toFlowEdges,
    toFlowNodes,
    type CardNode,
  } from "../editor/canvas";
  import { addLine } from "../editor/ops";
  import { m } from "../paraglide/messages.js";
  import NodeCard from "./NodeCard.svelte";
  import Palette from "./Palette.svelte";

  const nodeTypes = { card: NodeCard };
  const { screenToFlowPosition } = useSvelteFlow();

  let pane: HTMLDivElement | undefined = $state();
  let nodes = $state.raw<CardNode[]>([]);
  let edges = $state.raw<Edge[]>([]);

  // The project is the truth: the canvas is drawn again from it after every edit, and keeps the
  // selection that was there.
  $effect(() => {
    const flow = editor.flow;
    void editor.revision;
    const catalog = editor.catalog;
    untrack(() => {
      if (flow === null) {
        nodes = [];
        edges = [];
        return;
      }
      nodes = toFlowNodes(
        flow,
        catalog,
        new Set(nodes.filter((n) => n.selected).map((n) => n.id)),
      );
      edges = toFlowEdges(
        flow,
        new Set(edges.filter((e) => e.selected).map((e) => e.id)),
      );
    });
  });

  function canConnect(connection: Connection | Edge): boolean {
    const flow = editor.flow;
    if (flow === null || connection.sourceHandle == null) return false;
    return addLine(
      flow,
      editor.catalog,
      { node: connection.source, port: connection.sourceHandle },
      connection.target,
    ).ok;
  }

  function onconnect(connection: Connection): void {
    if (connection.sourceHandle == null) return;
    editor.connect(
      { node: connection.source, port: connection.sourceHandle },
      connection.target,
    );
  }

  function ondelete({
    nodes: gone,
    edges: lost,
  }: {
    nodes: CardNode[];
    edges: Edge[];
  }): void {
    editor.remove(
      new Set(gone.map((n) => n.id)),
      lost.flatMap((e) => lineOfEdge(e) ?? []),
    );
  }

  function onnodedragstop({ nodes: moved }: { nodes: Node[] }): void {
    for (const node of moved) editor.moveNode(node.id, node.position);
  }

  // A new node goes to the middle of what is on screen, a little lower for each one already there.
  function add(spec: Parameters<typeof editor.addNodeAt>[0]): void {
    const box = pane?.getBoundingClientRect();
    const count = editor.flow?.nodes.length ?? 0;
    const shift = (count % 6) * 24;
    const centre = screenToFlowPosition({
      x: (box?.left ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.top ?? 0) + (box?.height ?? 0) / 2,
    });
    editor.addNodeAt(spec, { x: centre.x + shift, y: centre.y + shift });
  }
</script>

<div
  class="pane"
  bind:this={pane}
  role="application"
  aria-label={m.canvas_label()}
>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    colorMode="system"
    fitView
    deleteKey={["Backspace", "Delete"]}
    isValidConnection={canConnect}
    {onconnect}
    {ondelete}
    {onnodedragstop}
  >
    <Background />
    <Controls showLock={false} />
  </SvelteFlow>
  <div class="palette">
    <Palette catalog={editor.catalog} onadd={add} />
  </div>
  {#if nodes.length === 0}
    <p class="empty">{m.canvas_empty()}</p>
  {/if}
</div>

<style>
  .pane {
    position: relative;
    height: 100%;
  }
  .palette {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 5;
    min-width: 10rem;
  }
  .empty {
    position: absolute;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    color: var(--muted);
    pointer-events: none;
  }
</style>
