import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TauriBackend } from "./TauriBackend";

describe("TauriBackend", () => {
  it.effect("answers from memory with the test layer", () =>
    Effect.gen(function* () {
      const backend = yield* TauriBackend;
      const info = yield* backend.appInfo();
      expect(info).toEqual({ name: "Bot Inventor", version: "0.0.0" });
    }).pipe(
      Effect.provide(
        TauriBackend.layerTest({ name: "Bot Inventor", version: "0.0.0" }),
      ),
    ),
  );
});
