import { describe, expect, it } from "vitest";
import { ping } from "./fixtures";
import {
  addRow,
  fieldPath,
  getSetting,
  parsePath,
  removeRow,
  renameAlias,
  rowPath,
  setSetting,
  withSettings,
  type Settings,
} from "./settings";

const item = [
  {
    name: "name",
    kind: {
      type: "Text" as const,
      value: { min: 1, max: 64, template: false },
    },
    required: true,
  },
  {
    name: "type",
    kind: { type: "Choice" as const, value: ["string", "integer"] },
    required: true,
  },
  { name: "required", kind: { type: "Boolean" as const }, required: false },
];

const options: Settings = {
  name: "ban",
  options: [
    { name: "user", type: "string" },
    { name: "reason", type: "string" },
  ],
};

describe("parsePath", () => {
  it("reads the paths compile writes", () => {
    expect(parsePath("content")).toEqual([{ key: "content" }]);
    expect(parsePath("options[0].name")).toEqual([
      { key: "options" },
      { index: 0 },
      { key: "name" },
    ]);
    expect(parsePath("a[1][2]")).toEqual([
      { key: "a" },
      { index: 1 },
      { index: 2 },
    ]);
  });

  it("refuses anything else", () => {
    for (const path of [
      "",
      ".a",
      "a.",
      "a..b",
      "[0]",
      "a[",
      "a[x]",
      "a b",
      "lines[0]x",
    ]) {
      expect(parsePath(path), path).toBeNull();
    }
  });

  it("builds the paths it reads", () => {
    expect(fieldPath("", "name")).toBe("name");
    expect(fieldPath(rowPath("options", 2), "name")).toBe("options[2].name");
  });
});

describe("getSetting", () => {
  it("reads a field and a field of a row", () => {
    expect(getSetting(options, "name")).toBe("ban");
    expect(getSetting(options, "options[1].name")).toBe("reason");
  });

  it("gives undefined for what is not there", () => {
    for (const path of [
      "nope",
      "options[5].name",
      "options[0].nope",
      "name.x",
      "!",
    ]) {
      expect(getSetting(options, path), path).toBeUndefined();
    }
  });
});

describe("setSetting", () => {
  it("sets a field and leaves the rest alone", () => {
    const next = setSetting(options, "name", "kick");
    expect(next.name).toBe("kick");
    expect(next.options).toBe(options.options);
    expect(options.name).toBe("ban");
  });

  it("sets a field of one row", () => {
    const next = setSetting(options, "options[1].name", "why");
    expect(getSetting(next, "options[1].name")).toBe("why");
    expect(getSetting(next, "options[0].name")).toBe("user");
    expect(getSetting(options, "options[1].name")).toBe("reason");
  });

  it("removes a field when the value is undefined", () => {
    const next = setSetting(options, "options[0].type", undefined);
    expect(getSetting(next, "options[0]")).toEqual({ name: "user" });
    expect(Object.keys(setSetting(options, "name", undefined))).toEqual([
      "options",
    ]);
  });

  it("returns the same object when nothing changes", () => {
    expect(setSetting(options, "name", "ban")).toBe(options);
    expect(setSetting(options, "nope", undefined)).toBe(options);
  });

  it("changes nothing for a path into a row that was removed", () => {
    for (const path of [
      "options[9].name",
      "nope.name",
      "options[9]",
      "options[0]",
      "",
      "x[",
    ]) {
      expect(setSetting(options, path, "v"), path).toBe(options);
    }
  });
});

describe("rows", () => {
  const list = { max: 3, item };

  it("adds a row with what its required fields can have", () => {
    const next = addRow(options, "options", list);
    expect(getSetting(next, "options[2]")).toEqual({ type: "string" });
  });

  it("creates the list when it is not there", () => {
    const next = addRow({ name: "x" }, "options", list);
    expect(getSetting(next, "options")).toEqual([{ type: "string" }]);
  });

  it("does not add past the maximum", () => {
    const full = addRow(options, "options", list);
    expect(addRow(full, "options", list)).toBe(full);
  });

  it("removes one row", () => {
    const next = removeRow(options, "options", 0, false);
    expect(getSetting(next, "options")).toEqual([
      { name: "reason", type: "string" },
    ]);
  });

  it("removes an optional list that is left empty, and keeps a required one", () => {
    const one: Settings = { options: [{ name: "a" }] };
    expect(removeRow(one, "options", 0, false)).toEqual({});
    expect(removeRow(one, "options", 0, true)).toEqual({ options: [] });
  });

  it("ignores a row that is not there", () => {
    for (const index of [-1, 2, 99]) {
      expect(removeRow(options, "options", index, false)).toBe(options);
    }
    expect(removeRow(options, "name", 0, false)).toBe(options);
  });
});

describe("renameAlias", () => {
  it("renames a node", () => {
    const result = renameAlias(ping, "n2", "answer");
    expect(result.ok && result.flow.nodes[1]?.alias).toBe("answer");
    expect(ping.nodes[1]?.alias).toBe("reply");
  });

  it("refuses an alias that is not valid or is taken, and changes nothing", () => {
    expect(renameAlias(ping, "n2", "Bad Name")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(renameAlias(ping, "n2", "")).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(renameAlias(ping, "n2", "ping_command")).toEqual({
      ok: false,
      error: "taken",
    });
    expect(renameAlias(ping, "zz", "x")).toEqual({
      ok: false,
      error: "unknown-node",
    });
  });

  it("accepts the alias the node already has", () => {
    expect(renameAlias(ping, "n2", "reply")).toEqual({ ok: true, flow: ping });
  });
});

describe("withSettings", () => {
  it("replaces the settings of one node", () => {
    const next = withSettings(ping, "n2", { content: "Hi" });
    expect(next.nodes[1]?.settings).toEqual({ content: "Hi" });
    expect(next.nodes[0]).toBe(ping.nodes[0]);
  });

  it("changes nothing for the same settings or an unknown node", () => {
    expect(withSettings(ping, "n2", ping.nodes[1]?.settings ?? {})).toBe(ping);
    expect(withSettings(ping, "zz", {})).toBe(ping);
  });
});
