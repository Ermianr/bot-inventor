import type { CompilerMode, NodeCatalogue } from "@bot-inventor/nodes"
import type { FlowFailure, TraceEvent } from "@bot-inventor/runtime"
import {
  createFakeRuntime,
  type FakeRuntimeOptions,
  type RecordedCall,
  type SlashCommandInput
} from "@bot-inventor/runtime/testing"
import type { Project } from "@bot-inventor/schema"

import { compile } from "./compile.js"

/**
 * The seam every Node's tests are written against: it takes a Project fixture
 * and the Discord events to simulate, compiles, runs the result against a fake
 * Discord client, and hands back what the bot asked Discord to do.
 *
 * Tests assert on those calls, never on the generated source, so how code is
 * emitted stays free to change.
 */

/** One thing that happens on Discord. */
export type SimulatedEvent = { type: "slashCommand" } & SlashCommandInput

export type RunProjectOptions = FakeRuntimeOptions & {
  /** Defaults to Build, which is the mode with no Tracing to get in the way. */
  mode?: CompilerMode
  catalogue?: NodeCatalogue
}

export type RunProjectResult = {
  /** What the bot asked Discord to do, in order. */
  calls: readonly RecordedCall[]
  /** The Flows that stopped because an action failed. */
  failures: readonly FlowFailure[]
  /** What Tracing reported. Empty in Build mode. */
  traces: readonly TraceEvent[]
  /** The slash commands the Project declared. */
  commands: readonly string[]
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (runtime: unknown) => Promise<void>

export async function runProject(
  project: Project,
  events: readonly SimulatedEvent[],
  options: RunProjectOptions = {}
): Promise<RunProjectResult> {
  // Everything left over is the fake Runtime's, so a knob added there reaches
  // callers without this helper having to learn about it.
  const { mode = "build", catalogue, ...fakeRuntimeOptions } = options

  const compiled = compile(project, { mode, catalogue })
  const runtime = createFakeRuntime(fakeRuntimeOptions)
  const defineBot = new AsyncFunction("runtime", compiled.program)
  await defineBot(runtime)

  for (const event of events) {
    await runtime.dispatchSlashCommand(event)
  }

  return {
    calls: runtime.calls,
    failures: runtime.failures,
    traces: runtime.traces,
    commands: runtime.commands
  }
}
