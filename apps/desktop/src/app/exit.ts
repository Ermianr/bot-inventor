import type { RunStatus } from "../lib/bindings";
import { m } from "../paraglide/messages.js";

type Exited = Extract<RunStatus, { state: "exited" }>;

/** What happened to a bot that exited, in words; an exit nobody asked for says so. */
export function describeExit(exit: Exited): string {
  const code = exit.code ?? -1;
  if (exit.requested) {
    if (exit.reason === "clean") return m.run_state_stopped();
    if (exit.reason === "signal") return m.run_exit_killed();
  }
  const reason = reasonText(exit, code);
  return exit.requested ? reason : m.run_exit_unexpected({ reason });
}

function reasonText(exit: Exited, code: number): string {
  switch (exit.reason) {
    case "clean":
      return m.run_exit_clean();
    case "failure":
      return m.run_exit_failure({ code });
    case "configuration":
      return m.run_exit_configuration({ code });
    case "payload_version":
      return m.run_exit_payload_version({ code });
    case "signal":
      return m.run_exit_signal({ signal: exit.signal ?? 0 });
  }
}
