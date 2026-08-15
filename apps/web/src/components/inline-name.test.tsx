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
      onRename={name => {
        named.push(name)
      }}
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

  it("hands over the name without the spaces around it", () => {
    const named = renameControl()
    const field = startEditing()

    fireEvent.change(field, { target: { value: "  Moderation bot  " } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(named).toEqual(["Moderation bot"])
  })

  it("leaves Enter to the IME while a name is being composed", () => {
    const named = renameControl()
    const field = startEditing()

    fireEvent.change(field, { target: { value: "モデ" } })
    fireEvent.keyDown(field, { key: "Enter", isComposing: true })

    expect(named).toEqual([])
    expect(screen.getByRole("textbox", { name: "The name of this bot" })).toBe(field)
  })

  it("confirms what was typed when the user clicks away", () => {
    const named = renameControl()
    const field = startEditing()

    fireEvent.change(field, { target: { value: "Moderation bot" } })
    fireEvent.blur(field)

    expect(named).toEqual(["Moderation bot"])
  })

  it("closes on a blank name clicked away, rather than trapping the user", () => {
    const named = renameControl()
    const field = startEditing()

    fireEvent.change(field, { target: { value: "  " } })
    fireEvent.blur(field)

    expect(named).toEqual([])
    expect(screen.getByRole("button", { name: "Rename this bot" })).toBeTruthy()
  })

  it("puts the focus back on the pencil once the keyboard closed the field", () => {
    renameControl()
    const field = startEditing()

    fireEvent.keyDown(field, { key: "Escape" })

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename this bot" }))
  })

  it("stays in the field when the name is refused by whoever placed the pencil", () => {
    const named: string[] = []
    render(
      <InlineName
        name="Hello bot"
        editLabel="Rename this bot"
        fieldLabel="The name of this bot"
        testId="project-name"
        onRename={name => {
          named.push(name)
          return false
        }}
      />
    )
    const field = startEditing()

    fireEvent.change(field, { target: { value: "Goodbye" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(named).toEqual(["Goodbye"])
    expect(screen.getByRole("textbox", { name: "The name of this bot" })).toBe(field)
    expect((field as HTMLInputElement).value).toBe("Goodbye")
  })

  it("closes on a refused name clicked away, rather than following the user", () => {
    render(
      <InlineName
        name="Hello bot"
        editLabel="Rename this bot"
        fieldLabel="The name of this bot"
        testId="project-name"
        onRename={() => false}
      />
    )
    const field = startEditing()

    fireEvent.change(field, { target: { value: "Goodbye" } })
    fireEvent.blur(field)

    expect(screen.getByTestId("project-name").textContent).toBe("Hello bot")
  })

  it("makes the name a button of its own when the caller can be chosen", () => {
    const chosen: string[] = []
    render(
      <InlineName
        name="Hello"
        editLabel="Rename this flow"
        fieldLabel="The name of this flow"
        testId="flow-name"
        onSelect={() => chosen.push("Hello")}
        onRename={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Hello" }))

    expect(chosen).toEqual(["Hello"])
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
