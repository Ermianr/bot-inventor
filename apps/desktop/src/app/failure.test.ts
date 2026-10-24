import { describe, expect, it } from "vitest";
import { BackendError } from "../services/TauriBackend";
import { describeFailure } from "./failure";

const fail = (cause: unknown) =>
  describeFailure(new BackendError({ command: "x", cause }));

describe("describeFailure", () => {
  it("shows the message Rust wrote", () => {
    expect(fail({ kind: "project", message: "bot.botproj not found" })).toBe(
      "bot.botproj not found",
    );
    expect(
      fail({ kind: "invalid_input", message: "choose an empty folder" }),
    ).toBe("choose an empty folder");
  });

  it("says there is no project", () => {
    expect(fail({ kind: "no_project" })).toBe("No project is open.");
  });

  it("gives a generic text for anything else", () => {
    const generic = "The app could not complete that action.";
    expect(fail(new Error("ipc is down"))).toBe(generic);
    expect(fail("text")).toBe(generic);
    expect(fail(null)).toBe(generic);
    expect(fail({ kind: "project" })).toBe(generic);
    expect(describeFailure(new Error("x"))).toBe(generic);
  });
});
