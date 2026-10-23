import { Effect } from "effect";
import type { AppInfo } from "../lib/bindings";
import { TauriBackend } from "../services/TauriBackend";
import { runtime } from "./runtime";

export type AppInfoState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly info: AppInfo }
  | { readonly status: "failed" };

/** The bridge between the Effect services and the components: fibers write, components read. */
class AppInfoStore {
  state = $state.raw<AppInfoState>({ status: "loading" });

  load(): void {
    const program = Effect.gen(function* () {
      const backend = yield* TauriBackend;
      return yield* backend.appInfo();
    });
    void runtime.runPromiseExit(program).then((exit) => {
      this.state =
        exit._tag === "Success"
          ? { status: "ready", info: exit.value }
          : { status: "failed" };
    });
  }
}

export const appInfo = new AppInfoStore();
