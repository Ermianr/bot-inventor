import { act, fireEvent } from "@testing-library/react"

import { settled } from "./settled"

/**
 * Presses a control, the way a test should press one.
 *
 * This is `fireEvent.click` with the two things around it that a test using
 * React needs and can forget. Before: [[settled]], because a control that has
 * only just appeared is not necessarily attached to what it belongs to yet, and
 * a click landing in that gap is dropped without a word rather than late.
 * After: `act`, so that whatever the press caused has happened by the time the
 * next line of the test reads the screen.
 *
 * It exists as one function rather than as a rule to remember because the two
 * are only ever forgotten together, and a test that forgets them does not fail
 * — it passes on a quiet machine and fails on a busy one, which is the most
 * expensive way for a test to be wrong.
 */
export async function press(control: Element): Promise<void> {
  await settled()
  await act(async () => {
    fireEvent.click(control)
  })
}
