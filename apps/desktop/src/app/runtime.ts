import { ManagedRuntime } from "effect";
import { TauriBackend } from "../services/TauriBackend";

/** The one runtime of the app; the whole dependency graph is visible here. */
export const runtime = ManagedRuntime.make(TauriBackend.layer);

// A hot reload must not leave a second runtime alive.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void runtime.dispose();
  });
}
