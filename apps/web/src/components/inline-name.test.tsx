// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { InlineName } from "@/components/inline-name"

/**
 * The renaming gesture itself, which nothing under it can see: whether Enter
 * confirms, Escape backs out and a blank name is refused is decided here and
 * nowhere else. `edits.test.ts` covers what the Project does with the name once
 * this control has agreed to hand it over.
 */

function renameControl() {
  const named: string[] = []

  render(
    <InlineName
      name="Hello bot"
      editLabel="Rename this bot"
      fieldLabel="The name of this bot"
      testId="project-name"
      onRename={name => named.push(name)}
    />
  )

  return named
}

function startEditing() {
  fireEvent.click(screen.getByRole("button", { name: "Rename this bot" }))
  return screen.getByRole("textbox", { name: "The name of this bot" })
}

afterEach(cleanup)

describe("renaming in place", () => {
  it("turns the name into a field holding the name it had", () => {
    renameControl()

    expect((startEditing() as HTMLInputElement).value).toBe("Hello bot")
  })

  it("confirms what was typed on Enter", () => {
    const named = renameControl()
    const field = startEditing()

    fireEvent.change(field, { target: { value: "Moderation bot" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(named).toEqual(["Moderation bot"])
    expect(screen.getByTestId("project-name").textContent).toBe("Hello bot")
  })

  it("backs out on Escape, leaving the name alone", () => {
    const named = renameControl()
    const field = startEditing()

    fireEvent.change(field, { target: { value: "Moderation bot" } })
    fireEvent.keyDown(field, { key: "Escape" })

    expect(named).toEqual([])
    expect(screen.getByTestId("project-name").textContent).toBe("Hello bot")
  })

  it("refuses a blank name and stays in the field", () => {
    const named = renameControl()
    const field = startEditing()

    fireEvent.change(field, { target: { value: "   " } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(named).toEqual([])
    expect(screen.getByRole("textbox", { name: "The name of this bot" })).toBe(field)
  })
})
